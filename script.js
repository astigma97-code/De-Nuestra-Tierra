/* ============================================================
DE NUESTRA TIERRA · script.js
· Cuentas de vendedor (registro / entrada / salida)
· Perfil editable: negocio, descripción, dirección, foto/emoji
· Publicación de productos con carrusel de hasta 6 fotos
· Vitrina dinámica en la portada, enlazada a cada perfil
Todo guardado en Supabase (Auth + Postgres + Storage).
============================================================ */
(() => {
'use strict';

/* 👉 Tus claves (Supabase → Settings → API) */
const SUPABASE_URL = 'https://nbnsgovzdzknrwbdldtl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bfNRZKhfM-deggZHlLALUQ_dWlcGk20';
const ADMIN_EMAIL = 'info.vitrinasanmarcos@gmail.com';
const ADMIN_PASSWORD = 'admin2026';
const ADMIN_WHATSAPP = '51940771593';
const CONTACTO_WHATSAPP = ADMIN_WHATSAPP;
const PLANES_DESTACADO = {
  '7': { dias: 7, precio: 10 },
  '15': { dias: 15, precio: 18 },
  '30': { dias: 30, precio: 30 }
};
const LOCAL_APP_KEY = 'de_nuestra_tierra_state_v1';
const IDS_DEMO = new Set(['v-1', 'v-2', 'v-3']);
const esDatoDemo = dato => IDS_DEMO.has(dato.id) || ['p-1', 'p-2', 'p-3', 'p-4'].includes(dato.id);

/* ---------- Utilidades ---------- */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const normalizar = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlImagen = valor => {
  if (!valor) return '';
  if (/^(blob:|data:image\/(?:jpeg|png|webp|gif);)/i.test(valor)) return valor;
  try {
    const url = new URL(valor, window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};
const soloDigitos = s => (s || '').replace(/\D/g, '');
const fmtPrecio = n => (+n).toFixed(2).replace(/\.00$/, '');
const categoriaFiltro = categoria => {
  const clave = categoriaClase(categoria);
  return { 'panaderia-y-reposteria': 'panaderia', 'textiles-y-ropa': 'textiles' }[clave] || clave;
};
const fechaCorta = fecha => new Date(fecha).toLocaleDateString('es-PE');
const destacadoVigente = p => Boolean(p.destacado && (!p.destacado_hasta || new Date(p.destacado_hasta) > new Date()));
const fechaParaCampo = fecha => {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const pad = valor => String(valor).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const categoriaClase = categoria => normalizar(categoria || 'otro').replace(/[^a-z0-9]+/g, '-');
const etiquetasProducto = producto => Array.isArray(producto?.tags)
  ? producto.tags.filter(Boolean).map(String).slice(0, 5)
  : [];
function guardarProductoLocal(producto) {
  const state = readLocalState();
  state.productos = [...state.productos.filter(item => item.id !== producto.id), { ...producto }];
  writeLocalState(state);
}
async function guardarDestacado(tabla, id, destacado, hasta) {
  const completo = await db.from(tabla).update({ destacado, destacado_hasta: hasta }).eq('id', id);
  if (completo.error) {
    const compatible = await db.from(tabla).update({ destacado }).eq('id', id);
    if (compatible.error) throw compatible.error;
  }
  const verificado = await db.from(tabla).select('id, destacado, destacado_hasta').eq('id', id).maybeSingle();
  if (verificado.error) throw verificado.error;
  if (!verificado.data || Boolean(verificado.data.destacado) !== Boolean(destacado)) {
    throw new Error('El destacado no pudo guardarse. Verifica los permisos de Supabase.');
  }
  if (hasta && verificado.data.destacado_hasta && new Date(verificado.data.destacado_hasta).getTime() !== new Date(hasta).getTime()) {
    throw new Error('La fecha guardada no coincide con la fecha seleccionada.');
  }
}

async function eliminarRegistros(tabla, filtros = []) {
  let consulta = db.from(tabla).delete();
  filtros.forEach(([campo, valor]) => { consulta = consulta.eq(campo, valor); });
  const resultado = await consulta;
  if (resultado.error) throw resultado.error;
}
async function eliminarRegistro(tabla, id, filtros = []) {
  await eliminarRegistros(tabla, [['id', id], ...filtros]);
}

async function eliminarTienda(id) {
  const idsProductos = productos.filter(producto => producto.vendedor_id === id).map(producto => producto.id);
  await eliminarRegistros('productos', [['vendedor_id', id]]);
  await eliminarRegistro('vendedores', id);
  return idsProductos;
}
const espera = (fn, ms = 220) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

const defaultState = {
  productos: [],
  vendedores: {},
  reseñas: [],
  solicitudesDestacado: []
};

const readLocalState = () => {
  try {
    const item = localStorage.getItem(LOCAL_APP_KEY);
    if (!item) {
      localStorage.setItem(LOCAL_APP_KEY, JSON.stringify(defaultState));
      return JSON.parse(JSON.stringify(defaultState));
    }
    const parsed = JSON.parse(item);
    const vendedoresReales = Object.fromEntries(Object.entries(parsed.vendedores || {}).filter(([, vendedor]) => !esDatoDemo(vendedor)));
    const productosReales = (parsed.productos || []).filter(producto => !esDatoDemo(producto));
    const actualizado = { ...JSON.parse(JSON.stringify(defaultState)), ...parsed, vendedores: vendedoresReales, productos: productosReales, reseñas: parsed.reseñas || [], solicitudesDestacado: parsed.solicitudesDestacado || [] };
    writeLocalState(actualizado);
    return actualizado;
  } catch {
    return JSON.parse(JSON.stringify(defaultState));
  }
};

const writeLocalState = (state) => localStorage.setItem(LOCAL_APP_KEY, JSON.stringify(state));

const makeLocalDb = () => {
  const getState = () => readLocalState();
  const save = state => writeLocalState(state);
  const normalizeUser = user => user ? { id: user.id, email: user.email, user_metadata: user.user_metadata || {} } : null;

  const tableQuery = (table) => {
    const snapshot = getState();
    const rows = table === 'productos'
      ? snapshot.productos
      : table === 'vendedores'
        ? Object.values(snapshot.vendedores)
        : table === 'reseñas'
          ? snapshot.reseñas
          : [];

    const api = {
      _table: table,
      _filters: [],
      select: () => api,
      order: () => api,
      eq: (field, value) => {
        api._filters.push([field, value]);
        return api;
      },
      maybeSingle: async () => {
        let data = rows;
        for (const [field, value] of api._filters) {
          data = data.filter(row => String(row[field]) === String(value));
        }
        return { data: data[0] || null };
      },
      update: record => {
        const modification = {
          filters: [],
          eq: (field, value) => { modification.filters.push([field, value]); return modification; },
          then: resolve => {
            const coincide = row => modification.filters.every(([field, value]) => String(row[field]) === String(value));
            rows.forEach(row => {
              if (coincide(row)) Object.assign(row, record);
            });
            save(snapshot);
            resolve({ error: null, data: rows.filter(coincide) });
          }
        };
        return modification;
      },
      delete: () => {
        const deletion = {
          filters: [],
          eq: (field, value) => { deletion.filters.push([field, value]); return deletion; },
          then: resolve => {
            const filtered = rows.filter(row => !deletion.filters.every(([field, value]) => String(row[field]) === String(value)));
            if (table === 'productos') snapshot.productos = filtered;
            if (table === 'vendedores') snapshot.vendedores = Object.fromEntries(filtered.map(row => [row.id, row]));
            save(snapshot);
            resolve({ error: null, data: filtered });
          }
        };
        return deletion;
      },
      insert: async (record) => {
        if (table === 'productos') {
          const producto = { id: `p-${Date.now()}`, ...record, creado_en: new Date().toISOString() };
          snapshot.productos.unshift(producto);
          save(snapshot);
          return { error: null, data: producto };
        }
        if (table === 'vendedores') {
          snapshot.vendedores[record.id] = { ...(snapshot.vendedores[record.id] || {}), ...record };
          save(snapshot);
        }
        if (table === 'reseñas') {
          snapshot.reseñas.unshift({ id: `r-${Date.now()}`, ...record, aprobado: false });
          save(snapshot);
        }
        return { error: null, data: record };
      },
      upsert: async (record) => {
        if (table === 'vendedores') {
          snapshot.vendedores[record.id] = { ...(snapshot.vendedores[record.id] || {}), ...record };
          save(snapshot);
        }
        if (table === 'productos') {
          const index = snapshot.productos.findIndex(p => p.id === record.id);
          if (index >= 0) snapshot.productos[index] = { ...snapshot.productos[index], ...record };
          else snapshot.productos.unshift({ id: record.id || `p-${Date.now()}`, ...record, creado_en: new Date().toISOString() });
          save(snapshot);
        }
        return { error: null };
      }
    };

    return api;
  };

  return {
    auth: {
      getSession: async () => {
        const user = JSON.parse(localStorage.getItem('de_nuestra_tierra_user') || 'null');
        return { data: { session: user ? { user: normalizeUser(user) } : null } };
      },
      signInWithPassword: async ({ email, password }) => {
        const normalizedEmail = (email || '').trim().toLowerCase();
        if (normalizedEmail === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          const user = { id: 'admin', email: ADMIN_EMAIL, user_metadata: { negocio: 'Administración' } };
          localStorage.setItem('de_nuestra_tierra_user', JSON.stringify(user));
          return { data: { user: normalizeUser(user) }, error: null };
        }
        const sessionUser = JSON.parse(localStorage.getItem('de_nuestra_tierra_users') || '{}');
        const found = Object.values(sessionUser).find(item => String(item.email).toLowerCase() === normalizedEmail && String(item.password) === String(password));
        if (found) {
          const user = { id: found.id, email: found.email, user_metadata: found.user_metadata || {} };
          localStorage.setItem('de_nuestra_tierra_user', JSON.stringify(user));
          return { data: { user: normalizeUser(user) }, error: null };
        }
        return { data: { user: null }, error: { message: 'Invalid login credentials' } };
      },
      signUp: async ({ email, password, options }) => {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const users = JSON.parse(localStorage.getItem('de_nuestra_tierra_users') || '{}');
        if (users[normalizedEmail]) {
          return { data: { session: null, user: null }, error: { message: 'User already registered' } };
        }
        const user = {
          id: `local-${Date.now()}`,
          email: normalizedEmail,
          password,
          user_metadata: options?.data || {}
        };
        users[normalizedEmail] = user;
        localStorage.setItem('de_nuestra_tierra_users', JSON.stringify(users));
        const userSession = { id: user.id, email: user.email, user_metadata: user.user_metadata };
        localStorage.setItem('de_nuestra_tierra_user', JSON.stringify(userSession));
        return { data: { session: { user: normalizeUser(userSession) }, user: normalizeUser(userSession) }, error: null };
      },
      signOut: async () => {
        localStorage.removeItem('de_nuestra_tierra_user');
        return { error: null };
      },
      onAuthStateChange: (callback) => {
        const user = JSON.parse(localStorage.getItem('de_nuestra_tierra_user') || 'null');
        callback('INITIAL_SESSION', user ? { user: normalizeUser(user) } : null);
        return () => {};
      }
    },
    from: (table) => tableQuery(table),
    storage: (() => {
      const archivos = {};
      return {
        from: () => {
        const blobComoDataUrl = blob => new Promise((resolve, reject) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = reject;
          lector.readAsDataURL(blob);
        });
        return {
          upload: async (ruta, blob) => {
            archivos[ruta] = await blobComoDataUrl(blob);
            return { error: null };
          },
          getPublicUrl: ruta => ({ data: { publicUrl: archivos[ruta] || '' } }),
          remove: async rutas => {
            (Array.isArray(rutas) ? rutas : [rutas]).forEach(ruta => delete archivos[ruta]);
            return { error: null };
          }
        };
        }
      };
    })()
  };
};

document.head.insertAdjacentHTML('beforeend', '<style>[hidden]{display:none!important}</style>');

const usaSupabase = Boolean(window.supabase && !SUPABASE_URL.includes('TU-PROYECTO'));
const db = usaSupabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : makeLocalDb();
const URL_REDIRECCION_AUTH = `${window.location.origin}${window.location.pathname}`;
const retornoConfirmacion = new URLSearchParams(window.location.hash.slice(1));
let vieneDeConfirmacion = retornoConfirmacion.get('type') === 'signup';

/* ---------- Estado ---------- */
let productos = [], vendedores = {}, usuario = null, miPerfil = null;
let fotosNuevas = [];
let carruselFotos = [], carruselIndex = 0, detalleEmoji = '🛒';
const MAX_FOTOS = 6;
const estado = { filtro: 'todos', busqueda: '', orden: 'recientes' };
const EMOJI_CAT = {
  Alimentos: '🛒', 'Lácteos': '🧀', 'Panadería': '🥖',
  'Panadería y repostería': '🥖', Carnes: '🥩', 'Frutas y verduras': '🥬',
  Abarrotes: '🛒', Bebidas: '🧃', Agro: '🥔', 'Plantas y semillas': '🌱',
  Artesanía: '🧺', Textiles: '🧶', 'Textiles y ropa': '👕',
  'Belleza y cuidado': '🧴', Hogar: '🏠', Salud: '🩺', Ferretería: '🔧',
  'Construcción': '🧱', Automotriz: '🚗', Servicios: '🛠️', Mascotas: '🐾',
  Tecnología: '📱', Otro: '🛍️'
};
const ETIQUETAS_DISPONIBLES = [
  'artesanal', 'fresco', 'casero', 'natural', 'local', 'dulce', 'salado', 'hecho a mano',
  'premium', 'economico', 'oferta', 'por encargo', 'temporada', 'sin conservantes', 'organico',
  'sin azucar', 'sin gluten', 'sin lactosa', 'vegano', 'vegetariano', 'articulo nuevo',
  'segunda mano', 'entrega disponible', 'servicio a domicilio', 'familiar', 'tradicional',
  'recien hecho', 'recien cosechado', 'hecho en san marcos', 'pequeno productor', 'mayoreo',
  'menudeo', 'regalo', 'personalizado', 'resistente', 'manual', 'ecologico', 'reutilizable',
  'biodegradable', 'sin quimicos', 'bajo en sal', 'alto en fibra', 'con garantia', 'reparacion',
  'instalacion', 'mantenimiento', 'delivery', 'disponible hoy', 'reserva', 'temporada escolar'
];

const listaProductos = $('#lista-productos');
const tiendaProductos = $('#tienda-productos');
const listaVendedores = $('#lista-vendedores');
const conteo = $('#conteo-productos');
const sinResultados = $('#sin-resultados');
const buscador = $('#buscador');
const zona = $('#zona-usuario');
const modalAuth = $('#modal-auth');
const modalPanel = $('#modal-panel');
const modalPublicar = $('#modal-publicar');
const modalAdmin = $('#modal-admin');
const modalDetalle = $('#modal-producto');
const modalTienda = $('#modal-tienda');
$('#publicar-contenedor').append($('#seccion-publicar'));
const frasesPorHorario = {
  mañana: [
    'fresco y cercano',
    'directo de nuestras manos a tu mesa',
    'despierto desde temprano'
  ],
  tarde: [
    'listo para llevarte lo mejor',
    'lo bueno de San Marcos, más cerca',
    'hecho con identidad'
  ],
  noche: [
    'abierto todo el día',
    'productos que cuentan historias',
    'compra local, apoya lo nuestro',
    'cada día, algo nuevo de nuestra tierra'
  ]
};
const INTERVALO_SLOGAN = 10 * 60 * 1000;
const INTERVALO_TESTIMONIO = 5 * 60 * 1000;
let intervaloTestimonios = null;

/* ---------- Carga de datos ---------- */
async function cargarDatos() {
  try {
    $('#conteo-productos').textContent = 'Cargando productos…';
    const [p, v] = await Promise.all([
      db.from('productos').select('*').order('creado_en', { ascending: false }),
      db.from('vendedores').select('*')
    ]);
    if (p.error || v.error) throw new Error(p.error?.message || v.error?.message || 'No se pudieron cargar los datos.');
    const local = readLocalState();
    productos = (p.data || []).filter(producto => !esDatoDemo(producto)).map(producto => {
      const localProducto = local.productos.find(item => item.id === producto.id);
      return {
        ...producto,
        ...(localProducto && !Array.isArray(producto.tags) ? { tags: localProducto.tags } : {})
      };
    });
    vendedores = Object.fromEntries((v.data || []).filter(vendedor => !esDatoDemo(vendedor)).map(x => [x.id, {
      ...x,
      ...(local.vendedores[x.id] || {})
    }]));
    await limpiarDestacadosVencidos();
    pintarVitrina();
    pintarVendedores();
    pintarMetricas();
    $('[data-reintentar]').hidden = true;
    if (usuario) pintarMisProductos();
  } catch (error) {
    const local = readLocalState();
    productos = (local.productos || []).filter(producto => !esDatoDemo(producto));
    vendedores = Object.fromEntries(Object.values(local.vendedores || {}).filter(vendedor => !esDatoDemo(vendedor)).map(vendedor => [vendedor.id, vendedor]));
    pintarVitrina();
    pintarVendedores();
    pintarMetricas();
    sinResultados.querySelector('.sin-resultados-titulo').textContent = productos.length ? 'Modo local activo.' : 'No pudimos cargar la vitrina.';
    sinResultados.querySelector('p:not(.sin-resultados-titulo)').textContent = productos.length ? 'Mostramos los datos guardados en este dispositivo.' : 'Revisa tu conexión e inténtalo nuevamente.';
    sinResultados.hidden = false;
    $('[data-reintentar]').hidden = false;
    console.error('Error al cargar la vitrina:', error);
  }
}

async function limpiarDestacadosVencidos() {
  const vencidos = productos.filter(p => p.destacado && !destacadoVigente(p));
  const tiendasVencidas = Object.values(vendedores).filter(v => v.destacado && !destacadoVigente(v));
  if (!vencidos.length && !tiendasVencidas.length) return false;
  const local = readLocalState();
  vencidos.forEach(producto => {
    producto.destacado = false;
    producto.destacado_hasta = null;
    const guardado = local.productos.find(item => item.id === producto.id);
    if (guardado) {
      guardado.destacado = false;
      guardado.destacado_hasta = null;
    }
  });
  tiendasVencidas.forEach(tienda => {
    tienda.destacado = false;
    tienda.destacado_hasta = null;
    const guardado = local.vendedores[tienda.id];
    if (guardado) {
      guardado.destacado = false;
      guardado.destacado_hasta = null;
    }
  });
  writeLocalState(local);
  await Promise.all([
    ...vencidos.map(producto => guardarDestacado('productos', producto.id, false, null)),
    ...tiendasVencidas.map(tienda => guardarDestacado('vendedores', tienda.id, false, null))
  ]);
  return true;
}

async function revisarExpiraciones() {
  try {
    const cambio = await limpiarDestacadosVencidos();
    if (!cambio) return;
    pintarVitrina();
    pintarVendedores();
    if (modalAdmin.open) renderAdminPanel();
  } catch (error) {
    console.error('No se pudieron actualizar los destacados vencidos:', error);
  }
}

/* ---------- Tarjeta de producto ---------- */
function tarjetaProducto(p) {
  const v = vendedores[p.vendedor_id] || {};
  const fotos = Array.isArray(p.fotos) ? p.fotos : [];
  const img = fotos.length
    ? `<img src="${esc(urlImagen(fotos[0]))}" alt="${esc(p.nombre)}" loading="lazy">`
    : `<span class="producto-emoji" aria-hidden="true">${p.emoji || EMOJI_CAT[p.categoria] || '🛒'}</span>`;
  const badgeFotos = fotos.length ? `<span class="producto-fotos">📷 ${fotos.length}</span>` : '';
  const etiquetas = etiquetasProducto(p);
  const etiquetasHtml = etiquetas.length
    ? `<div class="producto-tags" aria-label="Etiquetas del producto">${etiquetas.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>`
    : '';
  const destacado = destacadoVigente(p) ? '<span class="vendedor-destacado" title="Producto destacado" aria-label="Producto destacado">★</span>' : '';
  const destacadoActivo = destacadoVigente(p);
  return `<article class="producto ${destacadoActivo ? 'producto--destacado' : ''}" data-id="${p.id}" data-categoria="${categoriaFiltro(p.categoria)}" tabindex="0" role="button" aria-label="Ver ${esc(p.nombre)}">
    ${destacado}
    <div class="producto-imagen">
      <span class="producto-etiqueta">${esc(p.categoria || 'Varios')}</span>
      ${badgeFotos}${img}
    </div>
    <div class="producto-cuerpo">
      <h3>${esc(p.nombre)}</h3>
      ${p.detalle ? `<p class="producto-detalle">${esc(p.detalle)}</p>` : ''}
      ${etiquetasHtml}
      <button type="button" class="producto-vendedor" data-tienda="${p.vendedor_id}">🏪 ${esc(v.negocio || 'Vendedor local')}</button>
      <div class="producto-pie">
        <span class="producto-precio">S/ ${fmtPrecio(p.precio)}</span>
        <button type="button" class="boton-wsp" data-pedir="${p.id}">
          <svg class="icono"><use href="#i-whatsapp"/></svg>
          <span>Pedir</span>
        </button>
      </div>
    </div>
  </article>`;
}

/* ---------- Vitrina principal ---------- */
function pintarVitrina() {
  const q = normalizar(estado.busqueda.trim());
  const lista = productos.filter(p => {
    const v = vendedores[p.vendedor_id] || {};
    const tags = etiquetasProducto(p).map(t => normalizar(t)).join(' ');
    const porFiltro = estado.filtro === 'todos' || categoriaFiltro(p.categoria) === estado.filtro;
    const texto = normalizar(`${p.nombre} ${p.detalle || ''} ${p.categoria || ''} ${v.negocio || ''} ${tags}`);
    return porFiltro && (!q || texto.includes(q));
  });
  const ord = {
    'recientes': (a, b) => new Date(b.creado_en) - new Date(a.creado_en),
    'precio-asc': (a, b) => a.precio - b.precio,
    'precio-desc': (a, b) => b.precio - a.precio,
    'nombre': (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')
  }[estado.orden];
  lista.sort((a, b) => Number(destacadoVigente(b)) - Number(destacadoVigente(a)) || ord(a, b));
  listaProductos.innerHTML = lista.map(tarjetaProducto).join('');
  conteo.textContent = lista.length === 1
    ? '1 producto disponible, recién salido.'
    : `${lista.length} productos disponibles, recién salidos.`;
  sinResultados.hidden = lista.length > 0;
}

/* ---------- Vendedores ---------- */
function pintarVendedores() {
  const iniciales = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const lista = Object.values(vendedores).sort((a, b) => Number(destacadoVigente(b)) - Number(destacadoVigente(a)) || (a.negocio || '').localeCompare(b.negocio || '', 'es'));
  listaVendedores.innerHTML = lista.map(v => {
    const n = productos.filter(p => p.vendedor_id === v.id).length;
    const av = urlImagen(v.avatar_url) ? `<img src="${esc(urlImagen(v.avatar_url))}" alt="">` : esc(v.avatar_emoji || iniciales(v.negocio));
    const num = soloDigitos(v.whatsapp);
    const destacado = destacadoVigente(v);
    return `<article class="vendedor${destacado ? ' vendedor--destacado' : ''}">
      ${destacado ? '<span class="vendedor-destacado" title="Vendedor destacado" aria-label="Vendedor destacado">★</span>' : ''}
      <span class="vendedor-avatar" aria-hidden="true">${av}</span>
      <div class="vendedor-datos">
        <h3>${esc(v.negocio)}</h3>
        <p>${esc(v.responsable || 'Vendedor local')} · ${esc(v.categoria || 'Varios')}</p>
        ${v.direccion ? `<p class="vendedor-direccion">📍 ${esc(v.direccion)}</p>` : ''}
        <small>${n} producto(s) en vitrina</small>
      </div>
      <div class="vendedor-acciones">
        <button type="button" class="boton boton--linea" data-tienda="${v.id}">Ver tienda</button>
        <a class="boton-wsp" target="_blank" rel="noopener" aria-label="Escribir a ${esc(v.negocio)}" href="https://wa.me/${num}?text=${encodeURIComponent(`Hola ${v.negocio}, vi tu tienda en DE NUESTRA TIERRA.`)}">
          <svg class="icono"><use href="#i-whatsapp"/></svg>
        </a>
      </div>
    </article>`;
  }).join('') || '<p class="producto-detalle">Aún no hay tiendas registradas. ¡Sé la primera! 🌿</p>';
}

function pintarMetricas() {
  const cats = new Set(productos.map(p => p.categoria));
  $('[data-contador="productos"]').textContent = productos.length;
  $('[data-contador="vendedores"]').textContent = Object.keys(vendedores).length;
  $('[data-contador="categorias"]').textContent = cats.size;
}

/* ---------- Interacción con tarjetas ---------- */
function abrirWhatsAppProducto(id) {
  const p = productos.find(x => x.id === id); if (!p) return;
  const v = vendedores[p.vendedor_id] || {};
  const num = soloDigitos(v.whatsapp);
  const msg = encodeURIComponent(`Hola ${v.negocio || ''}, vi "${p.nombre}" en DE NUESTRA TIERRA y quiero hacer un pedido.`);
  window.open(`https://wa.me/${num}?text=${msg}`, '_blank', 'noopener');
}

document.addEventListener('click', e => {
  const pedir = e.target.closest('[data-pedir]');
  if (pedir) { abrirWhatsAppProducto(pedir.dataset.pedir); return; }
  const tienda = e.target.closest('[data-tienda]');
  if (tienda) { abrirTienda(tienda.dataset.tienda); }
});

[listaProductos, tiendaProductos].forEach(grid => {
  grid.addEventListener('click', e => {
    const card = e.target.closest('.producto');
    if (!card || e.target.closest('[data-tienda],[data-pedir]')) return;
    abrirDetalle(card.dataset.id);
  });
  grid.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('producto')) {
      e.preventDefault(); abrirDetalle(e.target.dataset.id);
    }
  });
});

/* ---------- Detalle de producto + carrusel ---------- */
function abrirDetalle(id) {
  const p = productos.find(x => x.id === id); if (!p) return;
  const v = vendedores[p.vendedor_id] || {};
  $('#detalle-categoria').textContent = p.categoria || 'Varios';
  $('#detalle-nombre').textContent = p.nombre;
  $('#detalle-detalle').textContent = p.detalle || 'Escríbele al vendedor por WhatsApp para más detalles.';
  $('#detalle-precio').textContent = `S/ ${fmtPrecio(p.precio)}`;
  const tags = etiquetasProducto(p).length ? ` · ${etiquetasProducto(p).join(', ')}` : '';
  $('#detalle-detalle').textContent = `${p.detalle || 'Escríbele al vendedor por WhatsApp para más detalles.'}${tags}`;
  const num = soloDigitos(v.whatsapp);
  $('#detalle-wsp').href = `https://wa.me/${num}?text=${encodeURIComponent(`Hola ${v.negocio || ''}, vi "${p.nombre}" en DE NUESTRA TIERRA y quiero hacer un pedido.`)}`;
  $('#detalle-vendedor-avatar').innerHTML = urlImagen(v.avatar_url) ? `<img src="${esc(urlImagen(v.avatar_url))}" alt="">` : esc(v.avatar_emoji || '🏪');
  $('#detalle-vendedor-nombre').textContent = v.negocio || 'Vendedor local';
  $('#detalle-vendedor').dataset.tienda = p.vendedor_id;
  carruselFotos = Array.isArray(p.fotos) ? p.fotos : [];
  carruselIndex = 0;
  detalleEmoji = p.emoji || EMOJI_CAT[p.categoria] || '🛒';
  pintarCarrusel();
  modalDetalle.showModal();
}

function pintarCarrusel() {
  const pista = $('#carrusel-pista'), puntos = $('#carrusel-puntos');
  const hayFotos = carruselFotos.length > 0;
  if (!hayFotos) {
    pista.innerHTML = `<div class="carrusel-slide carrusel-slide--emoji"><span>${detalleEmoji}</span></div>`;
    puntos.innerHTML = '';
  } else {
    pista.innerHTML = carruselFotos.map(f =>
      `<div class="carrusel-slide"><img src="${esc(urlImagen(f))}" alt="Foto del producto" loading="lazy"></div>`).join('');
    puntos.innerHTML = carruselFotos.map((_, i) =>
      `<button type="button" data-slide="${i}" aria-label="Ir a la foto ${i + 1}"></button>`).join('');
  }
  const una = carruselFotos.length < 2;
  $('#carrusel-prev').hidden = !hayFotos || una;
  $('#carrusel-next').hidden = !hayFotos || una;
  moverCarrusel();
}

function moverCarrusel() {
  $('#carrusel-pista').style.transform = `translateX(-${carruselIndex * 100}%)`;
  $$('#carrusel-puntos button').forEach((b, i) => b.classList.toggle('activo', i === carruselIndex));
}

$('#carrusel-prev').addEventListener('click', () => {
  carruselIndex = (carruselIndex - 1 + carruselFotos.length) % carruselFotos.length; moverCarrusel();
});
$('#carrusel-next').addEventListener('click', () => {
  carruselIndex = (carruselIndex + 1) % carruselFotos.length; moverCarrusel();
});
$('#carrusel-puntos').addEventListener('click', e => {
  const b = e.target.closest('[data-slide]'); if (!b) return;
  carruselIndex = +b.dataset.slide; moverCarrusel();
});

let toqueX = null;
const carruselEl = $('#detalle-carrusel');
carruselEl.addEventListener('touchstart', e => { toqueX = e.touches[0].clientX; }, { passive: true });
carruselEl.addEventListener('touchend', e => {
  if (toqueX === null || carruselFotos.length < 2) return;
  const dx = e.changedTouches[0].clientX - toqueX;
  if (Math.abs(dx) > 40) (dx < 0 ? $('#carrusel-next') : $('#carrusel-prev')).click();
  toqueX = null;
}, { passive: true });

/* ---------- Perfil público de tienda ---------- */
function abrirTienda(id) {
  const v = vendedores[id]; if (!v) return;
  if (modalDetalle.open) modalDetalle.close();
  $('#tienda-avatar').innerHTML = urlImagen(v.avatar_url) ? `<img src="${esc(urlImagen(v.avatar_url))}" alt="">` : esc(v.avatar_emoji || '🏪');
  $('#tienda-nombre').textContent = v.negocio;
  $('#tienda-responsable').textContent = v.responsable ? `Atiende: ${v.responsable}` : '';
  $('#tienda-direccion').textContent = v.direccion ? `📍 ${v.direccion}` : '📍 San Marcos, Cajamarca';
  $('#tienda-descripcion').textContent = v.descripcion || 'Este vendedor aún no agregó una descripción.';
  $('#tienda-categoria').textContent = v.categoria || 'Varios';
  const deTienda = productos.filter(p => p.vendedor_id === id).sort((a, b) => Number(destacadoVigente(b)) - Number(destacadoVigente(a)) || new Date(b.creado_en || 0) - new Date(a.creado_en || 0));
  $('#tienda-conteo').textContent = `${deTienda.length} producto(s) en vitrina`;
  $('#tienda-wsp').href = `https://wa.me/${soloDigitos(v.whatsapp)}?text=${encodeURIComponent(`Hola ${v.negocio}, vi tu tienda en DE NUESTRA TIERRA.`)}`;
  tiendaProductos.innerHTML = deTienda.map(tarjetaProducto).join('') || '<p class="producto-detalle">Aún no hay productos publicados.</p>';
  if (!modalTienda.open) modalTienda.showModal();
}

/* ---------- Filtros, búsqueda y orden ---------- */
const chips = $$('.chip[data-filtro]');
chips.forEach(chip => chip.addEventListener('click', () => {
  estado.filtro = chip.dataset.filtro;
  chips.forEach(c => { const a = c === chip; c.classList.toggle('chip--activo', a); c.setAttribute('aria-pressed', a); });
  pintarVitrina();
}));

buscador.addEventListener('input', espera(() => { estado.busqueda = buscador.value; pintarVitrina(); }));
$('#form-busqueda').addEventListener('submit', e => { e.preventDefault(); estado.busqueda = buscador.value; pintarVitrina(); });
$('[data-reintentar]').addEventListener('click', () => { $('[data-reintentar]').hidden = true; cargarDatos(); });
$$('[data-buscar]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); buscador.value = a.dataset.buscar; estado.busqueda = a.dataset.buscar;
  pintarVitrina(); $('#productos').scrollIntoView({ behavior: 'smooth' });
}));
$('#ordenar').addEventListener('change', e => { estado.orden = e.target.value; pintarVitrina(); });
$('[data-limpiar-filtros]').addEventListener('click', () => {
  estado.filtro = 'todos'; estado.busqueda = ''; buscador.value = '';
  chips.forEach(c => { const t = c.dataset.filtro === 'todos'; c.classList.toggle('chip--activo', t); c.setAttribute('aria-pressed', t); });
  pintarVitrina();
});

/* ---------- Menú móvil ---------- */
const cabecera = $('.cabecera'), botonMenu = $('#boton-menu');
const cerrarMenu = () => { cabecera.classList.remove('abierta'); botonMenu.setAttribute('aria-expanded', 'false'); };
botonMenu.addEventListener('click', e => {
  e.stopPropagation();
  botonMenu.setAttribute('aria-expanded', cabecera.classList.toggle('abierta'));
});
$('#navegacion').addEventListener('click', e => { if (e.target.matches('a')) cerrarMenu(); });
document.addEventListener('click', e => { if (cabecera.classList.contains('abierta') && !cabecera.contains(e.target)) cerrarMenu(); });

/* ---------- Sesión y zona de usuario ---------- */
async function cargarPerfil() {
  if (!usuario) { miPerfil = null; return; }
  const r = await db.from('vendedores').select('*').eq('id', usuario.id).maybeSingle();
  miPerfil = r.data;
}

async function completarPerfilTrasConfirmacion() {
  if (!usuario || usuario.email === ADMIN_EMAIL || miPerfil || !usuario.user_metadata?.negocio) return;
  const metadata = usuario.user_metadata;
  const { error } = await db.from('vendedores').upsert({
    id: usuario.id,
    negocio: metadata.negocio,
    responsable: metadata.responsable || '',
    whatsapp: metadata.whatsapp || '',
    categoria: metadata.categoria || 'Otro',
    descripcion: 'Tienda creada desde DE NUESTRA TIERRA.'
  });
  if (error) throw error;
  await cargarPerfil();
}

function limpiarRetornoAuth() {
  if (!window.location.hash) return;
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
}

function pintarZonaUsuario() {
  if (usuario && usuario.email === ADMIN_EMAIL) {
    zona.innerHTML = `<button type="button" class="chip chip-avatar chip--activo" data-accion="admin" title="Panel de administración"> <span class="admin-logo"><img src="DE%20NUESTRA%20TIERRA%20SM.jpeg" alt=""></span>Administración</button> <button type="button" class="boton boton--linea" data-accion="salir">Salir</button>`;
  } else if (usuario && miPerfil) {
    const av = urlImagen(miPerfil.avatar_url) ? `<img src="${esc(urlImagen(miPerfil.avatar_url))}" alt="">` : esc(miPerfil.avatar_emoji || '🏪');
    zona.innerHTML = `<button type="button" class="boton boton--ambar boton-publicar-rapido" data-accion="publicar" title="Publicar un producto">＋ Publicar</button> <button type="button" class="chip chip-avatar chip--activo" data-accion="panel" title="Administrar mi tienda"> <span>${av}</span>${esc(miPerfil.negocio || 'Mi tienda')}</button> <button type="button" class="boton boton--linea" data-accion="salir">Salir</button>`;
  } else if (usuario) {
    zona.innerHTML = `<button type="button" class="boton boton--ambar" data-accion="panel">Completar mi perfil</button>`;
  } else {
    zona.innerHTML = `<button type="button" class="boton boton--linea" data-accion="entrar">Entrar</button> <button type="button" class="boton boton--ambar" data-accion="crear">Vender aquí</button>`;
  }
}

zona.addEventListener('click', e => {
  const a = e.target.closest('[data-accion]'); if (!a) return;
  const acc = a.dataset.accion;
  if (acc === 'entrar') abrirAuth('entrar');
  if (acc === 'crear') abrirAuth('crear');
  if (acc === 'salir') db.auth.signOut();
  if (acc === 'panel') abrirPanel();
  if (acc === 'publicar') abrirPublicador();
  if (acc === 'admin') abrirAdmin();
});

db.auth.onAuthStateChange((_ev, ses) => {
  usuario = ses?.user || null;
  cargarPerfil()
    .then(completarPerfilTrasConfirmacion)
    .then(() => {
      pintarZonaUsuario();
      if (usuario) pintarMisProductos();
      if (vieneDeConfirmacion && usuario) {
        limpiarRetornoAuth();
        vieneDeConfirmacion = false;
        abrirPanel();
      }
    })
    .catch(error => console.error('No se pudo completar el perfil:', error));
});

/* ---------- Modal auth ---------- */
function abrirAuth(tab) {
  $('#auth-error').hidden = true;
  cambiarTab(tab);
  modalAuth.showModal();
}

function cambiarTab(tab) {
  $$('.auth-tabs [data-tab]').forEach(b => b.classList.toggle('chip--activo', b.dataset.tab === tab));
  $('#form-entrar').hidden = tab !== 'entrar';
  $('#form-crear').hidden = tab !== 'crear';
}

$$('.auth-tabs [data-tab]').forEach(b => b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
$$('[data-abrir-auth]').forEach(b => b.addEventListener('click', () => abrirAuth(b.dataset.abrirAuth)));

const errAuth = (msg, ok) => {
  const el = $('#auth-error');
  el.hidden = false; el.textContent = msg;
  el.className = 'modal-nota ' + (ok ? 'msg-ok' : 'msg-error');
};

const traducir = m => ({
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'User already registered': 'Ese correo ya está registrado. Prueba entrando.',
  'Email not confirmed': 'Confirma tu correo antes de entrar.'
}[m] || m);

$('#c-pass-mostrar').addEventListener('click', e => {
  const campo = $('#c-pass');
  const visible = campo.type === 'text';
  campo.type = visible ? 'password' : 'text';
  e.currentTarget.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  e.currentTarget.setAttribute('aria-pressed', String(!visible));
});

$('#form-entrar').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
  const email = $('#e-email').value.trim();
  const password = $('#e-pass').value;
  try {
    if (email.toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      if (usaSupabase) {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) return errAuth(traducir(error.message));
        modalAuth.close(); e.target.reset();
        return;
      }
      usuario = { id: 'admin', email: ADMIN_EMAIL, user_metadata: { negocio: 'Administración' } };
      miPerfil = { id: 'admin', negocio: 'Administración', responsable: 'Admin', whatsapp: CONTACTO_WHATSAPP, categoria: 'General', descripcion: 'Panel de administración', avatar_emoji: '🏞️', avatar_url: '' };
      localStorage.setItem('de_nuestra_tierra_user', JSON.stringify(usuario));
      pintarZonaUsuario();
      modalAuth.close(); e.target.reset();
      abrirAdmin();
      return;
    }
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) return errAuth(traducir(error.message));
    modalAuth.close(); e.target.reset();
  } catch (error) {
    errAuth('No se pudo iniciar sesión. Revisa tu conexión e inténtalo nuevamente.');
    console.error('Error de inicio de sesión:', error);
  } finally {
    btn.disabled = false;
  }
});

$('#form-crear').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
  $('#auth-error').hidden = true;
  try {
    const negocio = $('#c-negocio').value.trim();
    const responsable = $('#c-responsable').value.trim();
    const email = $('#c-email').value.trim();
    const password = $('#c-pass').value;
    const passwordConfirmada = $('#c-pass-confirmar').value;
    if (password !== passwordConfirmada) {
      errAuth('Las contraseñas no coinciden. Escríbelas nuevamente.', false);
      btn.disabled = false;
      return;
    }
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: URL_REDIRECCION_AUTH,
        data: {
          negocio,
          responsable,
          whatsapp: soloDigitos($('#c-whats').value),
          categoria: $('#c-categoria').value
        }
      }
    });
    if (error) throw new Error(traducir(error.message));
    if (!data.session) {
      errAuth('Cuenta creada ✅ Abre el enlace del correo para confirmar. Volverás aquí con tu sesión iniciada automáticamente.', true);
      btn.disabled = false; return;
    }
    usuario = data.session.user;
    await db.from('vendedores').upsert({
      id: usuario.id,
      negocio,
      responsable,
      whatsapp: soloDigitos($('#c-whats').value),
      categoria: $('#c-categoria').value,
      descripcion: 'Tienda creada desde DE NUESTRA TIERRA.'
    });
    await cargarPerfil(); pintarZonaUsuario();
    modalAuth.close(); e.target.reset();
    abrirPanel();
  } catch (er) { errAuth(er.message); }
  btn.disabled = false;
});

/* ---------- Imágenes: redimensionar y subir ---------- */
function procesarImagen(file, max = 900) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); res(b); }, 'image/jpeg', .82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Formato de imagen no compatible. Usa JPG, PNG o WebP.')); };
    img.src = url;
  });
}

async function subirFoto(blob, ruta) {
  const { error } = await db.storage.from('fotos').upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return db.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
}

/* ---------- Panel: abrir y cargar perfil ---------- */
function abrirPanel() {
  if (!usuario) return abrirAuth('entrar');
  if (usuario.email === ADMIN_EMAIL) return abrirAdmin();
  if (miPerfil) {
    $('#p-negocio').value = miPerfil.negocio || '';
    $('#p-responsable').value = miPerfil.responsable || '';
    $('#p-descripcion').value = miPerfil.descripcion || '';
    $('#p-whats').value = miPerfil.whatsapp || '';
    $('#p-categoria').value = miPerfil.categoria || 'Alimentos';
    $('#p-direccion').value = miPerfil.direccion || '';
    $('#p-emoji').value = miPerfil.avatar_emoji || '';
    $('#avatar-preview').innerHTML = urlImagen(miPerfil.avatar_url)
      ? `<img src="${esc(urlImagen(miPerfil.avatar_url))}" alt="">`
      : esc(miPerfil.avatar_emoji || '🏪');
    $('#p-avatar').value = '';
  }
  pintarMisProductos();
  modalPanel.showModal();
}

function abrirPublicador() {
  if (!usuario) return abrirAuth('entrar');
  if (usuario.email === ADMIN_EMAIL) return abrirAdmin();
  if (!miPerfil) return abrirPanel();
  modalPublicar.showModal();
  requestAnimationFrame(() => {
    $('#g-nombre').focus();
  });
}

function renderAdminPanel() {
  const adminResenas = $('#admin-reseñas');
  const adminTiendas = $('#admin-tiendas');
  const adminProductos = $('#admin-productos');
  const adminSolicitudes = $('#admin-solicitudes');
  const state = readLocalState();
  const tiendasActuales = Object.values(vendedores).filter(v => !esDatoDemo(v));
  const productosActuales = productos.filter(p => !esDatoDemo(p));

  const reseñas = state.reseñas || [];
  adminResenas.innerHTML = reseñas.length
    ? reseñas.map(r => `
        <div class="admin-item">
          <strong>${esc(r.nombre)} · ${esc(r.negocio)}</strong>
          <small>${esc(r.texto)}</small>
          <small>Estado: ${r.aprobado ? 'Aprobada' : 'Pendiente de revisión'}</small>
          <div class="admin-actions">
            ${r.aprobado ? '' : `<button type="button" class="boton-ok" data-reseña-aprobar="${r.id}">Aprobar</button>`}
            <button type="button" class="boton-peligro" data-reseña-eliminar="${r.id}">Eliminar</button>
          </div>
        </div>
      `).join('')
    : '<p class="producto-detalle">No hay reseñas para revisar.</p>';

  adminTiendas.innerHTML = tiendasActuales.map(v => `
    <div class="admin-item">
      <strong>${esc(v.negocio || 'Tienda sin nombre')}</strong>
      <small>${esc(v.responsable || 'Sin responsable')} · ${esc(v.categoria || 'General')}</small>
      <div class="admin-actions">
        <button type="button" class="boton-destacar" data-tienda-destacar="${v.id}">${destacadoVigente(v) ? 'Quitar destacado' : 'Destacar'}</button>
        <button type="button" class="boton-peligro" data-tienda-eliminar="${v.id}">Eliminar</button>
      </div>
      <div class="admin-fecha-destacado">
        <label for="expiracion-tienda-${v.id}">Expira el</label>
        <input id="expiracion-tienda-${v.id}" type="datetime-local" min="${fechaParaCampo(new Date())}" value="${fechaParaCampo(v.destacado_hasta)}" data-expiracion-tienda="${v.id}">
        <button type="button" class="boton-ok" data-guardar-expiracion-tienda="${v.id}">Guardar fecha</button>
      </div>
    </div>
  `).join('') || '<p class="producto-detalle">No hay tiendas registradas.</p>';

  adminProductos.innerHTML = productosActuales.map(p => `
    <div class="admin-item">
      <strong>${esc(p.nombre)}</strong>
      <small>${esc(p.categoria || 'General')} · S/ ${fmtPrecio(p.precio)}${destacadoVigente(p) ? ` · activo hasta ${fechaCorta(p.destacado_hasta)}` : ''}</small>
      <div class="admin-actions">
        <button type="button" class="boton-destacar" data-producto-destacar="${p.id}">${destacadoVigente(p) ? 'Quitar destacado' : 'Destacar'}</button>
        <button type="button" class="boton-peligro" data-producto-eliminar="${p.id}">Eliminar</button>
      </div>
      <div class="admin-fecha-destacado">
        <label for="expiracion-${p.id}">Expira el</label>
        <input id="expiracion-${p.id}" type="datetime-local" min="${fechaParaCampo(new Date())}" value="${fechaParaCampo(p.destacado_hasta)}" data-expiracion-producto="${p.id}">
        <button type="button" class="boton-ok" data-guardar-expiracion="${p.id}">Guardar fecha</button>
      </div>
    </div>
  `).join('') || '<p class="producto-detalle">No hay productos en la vitrina.</p>';

  const solicitudes = state.solicitudesDestacado || [];
  adminSolicitudes.innerHTML = solicitudes.length
    ? solicitudes.map(s => {
        const producto = state.productos.find(p => p.id === s.producto_id);
        const vendedor = state.vendedores[s.vendedor_id] || {};
        return `<div class="admin-item">
          <strong>${esc(producto?.nombre || 'Producto eliminado')}</strong>
          <small>${esc(vendedor.negocio || 'Vendedor')} · ${s.dias} días · S/ ${fmtPrecio(s.precio)} · ${esc(s.estado)}</small>
          <small>Solicitado: ${fechaCorta(s.creado_en)}</small>
          <div class="admin-actions">
            <a class="boton-ok" href="https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(`Hola, confirmo el pago del destacado de ${producto?.nombre || 'producto'} por ${s.dias} días.`)}" target="_blank" rel="noopener">Hablar por WhatsApp</a>
            ${s.estado === 'pendiente' ? `<button type="button" class="boton-ok" data-solicitud-aprobar="${s.id}">Confirmar pago y activar</button><button type="button" class="boton-peligro" data-solicitud-rechazar="${s.id}">Rechazar</button>` : ''}
          </div>
        </div>`;
      }).join('')
    : '<p class="producto-detalle">No hay solicitudes de destacado.</p>';
}

function abrirAdmin() {
  if (!usuario) return abrirAuth('entrar');
  if (usuario.email !== ADMIN_EMAIL) {
    errAuth('Este panel es solo para administración.', false);
    return;
  }
  renderAdminPanel();
  modalAdmin.showModal();
}

function solicitarDestacado(productoId, vendedorId, dias) {
  const plan = PLANES_DESTACADO[dias];
  if (!plan) return;
  const state = readLocalState();
  const producto = state.productos.find(p => p.id === productoId);
  if (!producto) return;
  const existente = (state.solicitudesDestacado || []).find(s => s.producto_id === productoId && s.estado === 'pendiente');
  if (existente) return alert('Este producto ya tiene una solicitud pendiente de confirmación.');
  state.solicitudesDestacado = [{
    id: `sd-${Date.now()}`,
    producto_id: productoId,
    vendedor_id: vendedorId,
    dias: plan.dias,
    precio: plan.precio,
    estado: 'pendiente',
    creado_en: new Date().toISOString()
  }, ...(state.solicitudesDestacado || [])];
  writeLocalState(state);
  const mensaje = `Hola, quiero destacar "${producto.nombre}" por ${plan.dias} días. El monto es S/ ${plan.precio}. Adjunto mi comprobante de pago.`;
  window.open(`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener');
  pintarMisProductos();
  alert('Solicitud registrada. Envía tu comprobante por WhatsApp; administración activará el destacado al confirmar el pago.');
}

$('#admin-reseñas').addEventListener('click', e => {
  const aprobar = e.target.closest('[data-reseña-aprobar]');
  const eliminar = e.target.closest('[data-reseña-eliminar]');
  const state = readLocalState();
  if (aprobar) {
    const item = state.reseñas.find(r => r.id === aprobar.dataset.reseñaAprobar);
    if (item) item.aprobado = true;
    writeLocalState(state);
    renderAdminPanel();
    renderizarReseñas();
  }
  if (eliminar) {
    if (!confirm('¿Eliminar esta reseña?')) return;
    state.reseñas = state.reseñas.filter(r => r.id !== eliminar.dataset.reseñaEliminar);
    writeLocalState(state);
    renderAdminPanel();
    renderizarReseñas();
  }
});

$('#admin-tiendas').addEventListener('click', async e => {
  const state = readLocalState();
  const destacar = e.target.closest('[data-tienda-destacar]');
  const guardarFecha = e.target.closest('[data-guardar-expiracion-tienda]');
  const eliminar = e.target.closest('[data-tienda-eliminar]');
  if (guardarFecha) {
    const tienda = vendedores[guardarFecha.dataset.guardarExpiracionTienda];
    const campo = document.querySelector(`[data-expiracion-tienda="${guardarFecha.dataset.guardarExpiracionTienda}"]`);
    if (!tienda || !campo) return;
    if (!campo.value) {
      tienda.destacado = false;
      tienda.destacado_hasta = null;
    } else {
      const fecha = new Date(campo.value);
      if (Number.isNaN(fecha.getTime()) || fecha <= new Date()) {
        alert('Selecciona una fecha futura para activar el destacado.');
        return;
      }
      tienda.destacado = true;
      tienda.destacado_hasta = fecha.toISOString();
    }
    try {
      guardarFecha.disabled = true;
      await guardarDestacado('vendedores', tienda.id, tienda.destacado, tienda.destacado_hasta);
      state.vendedores[tienda.id] = { ...(state.vendedores[tienda.id] || {}), ...tienda };
      writeLocalState(state);
      await cargarDatos();
      renderAdminPanel();
    } catch (error) {
      alert(`No se pudo guardar la fecha del destacado: ${error.message}`);
    } finally {
      guardarFecha.disabled = false;
    }
    return;
  }
  if (destacar) {
    const tienda = vendedores[destacar.dataset.tiendaDestacar];
    if (tienda) {
      try {
        const destacado = !destacadoVigente(tienda);
        const hasta = destacado ? new Date(Date.now() + 30 * 86400000).toISOString() : null;
        await guardarDestacado('vendedores', tienda.id, destacado, hasta);
        tienda.destacado = destacado;
        tienda.destacado_hasta = hasta;
        state.vendedores[tienda.id] = { ...(state.vendedores[tienda.id] || {}), ...tienda };
        writeLocalState(state);
        await cargarDatos();
        renderAdminPanel();
      } catch (error) {
        alert(`No se pudo actualizar el destacado de la tienda: ${error.message}`);
      }
    }
  }
  if (eliminar) {
    if (!confirm('¿Eliminar esta tienda? La acción no se puede deshacer.')) return;
    try {
      const tiendaId = eliminar.dataset.tiendaEliminar;
      const idsProductos = await eliminarTienda(tiendaId);
      delete state.vendedores[tiendaId];
      state.productos = state.productos.filter(producto => producto.vendedor_id !== tiendaId);
      state.solicitudesDestacado = (state.solicitudesDestacado || []).filter(solicitud =>
        solicitud.vendedor_id !== tiendaId && !idsProductos.includes(solicitud.producto_id)
      );
      writeLocalState(state);
      await cargarDatos();
      renderAdminPanel();
    } catch (error) {
      alert(`No se pudo eliminar la tienda: ${error.message}`);
    }
  }
});

$('#admin-productos').addEventListener('click', async e => {
  const state = readLocalState();
  const guardarFecha = e.target.closest('[data-guardar-expiracion]');
  const destacar = e.target.closest('[data-producto-destacar]');
  const eliminar = e.target.closest('[data-producto-eliminar]');
  if (guardarFecha) {
    const producto = productos.find(p => p.id === guardarFecha.dataset.guardarExpiracion);
    const campo = document.querySelector(`[data-expiracion-producto="${guardarFecha.dataset.guardarExpiracion}"]`);
    if (!producto || !campo) return;
    if (!campo.value) {
      producto.destacado = false;
      producto.destacado_hasta = null;
    } else {
      const fecha = new Date(campo.value);
      if (Number.isNaN(fecha.getTime()) || fecha <= new Date()) {
        alert('Selecciona una fecha futura para activar el destacado.');
        return;
      }
      producto.destacado = true;
      producto.destacado_hasta = fecha.toISOString();
    }
    try {
      guardarFecha.disabled = true;
      await guardarDestacado('productos', producto.id, producto.destacado, producto.destacado_hasta);
      guardarProductoLocal(producto);
      await cargarDatos();
      guardarProductoLocal(productos.find(item => item.id === producto.id) || producto);
      renderAdminPanel();
    } catch (error) {
      alert(`No se pudo guardar la fecha del destacado: ${error.message}`);
    } finally {
      guardarFecha.disabled = false;
    }
    return;
  }
  if (destacar) {
    const producto = productos.find(p => p.id === destacar.dataset.productoDestacar);
    if (producto) {
      try {
        producto.destacado = !destacadoVigente(producto);
        producto.destacado_hasta = producto.destacado ? new Date(Date.now() + 30 * 86400000).toISOString() : null;
        await guardarDestacado('productos', producto.id, producto.destacado, producto.destacado_hasta);
        guardarProductoLocal(producto);
        await cargarDatos();
      } catch (error) {
        alert(`No se pudo actualizar el destacado del producto: ${error.message}`);
      }
    }
    renderAdminPanel();
  }
  if (eliminar) {
    if (!confirm('¿Eliminar este producto? La acción no se puede deshacer.')) return;
    try {
      await eliminarRegistro('productos', eliminar.dataset.productoEliminar);
      state.productos = state.productos.filter(p => p.id !== eliminar.dataset.productoEliminar);
      writeLocalState(state);
      await cargarDatos();
      renderAdminPanel();
    } catch (error) {
      alert(`No se pudo eliminar el producto: ${error.message}`);
    }
  }
});

$('#admin-solicitudes').addEventListener('click', async e => {
  const aprobar = e.target.closest('[data-solicitud-aprobar]');
  const rechazar = e.target.closest('[data-solicitud-rechazar]');
  const id = aprobar?.dataset.solicitudAprobar || rechazar?.dataset.solicitudRechazar;
  if (!id) return;
  const state = readLocalState();
  const solicitud = (state.solicitudesDestacado || []).find(s => s.id === id);
  if (!solicitud) return;
  const producto = state.productos.find(p => p.id === solicitud.producto_id);
  try {
    if (aprobar) {
      if (!producto) throw new Error('El producto solicitado ya no existe.');
      producto.destacado = true;
      producto.destacado_hasta = new Date(Date.now() + solicitud.dias * 86400000).toISOString();
      await guardarDestacado('productos', producto.id, true, producto.destacado_hasta);
      solicitud.estado = 'aprobada';
      solicitud.aprobada_en = new Date().toISOString();
    }
    if (rechazar) solicitud.estado = 'rechazada';
    writeLocalState(state);
    renderAdminPanel();
    await cargarDatos();
  } catch (error) {
    alert(`No se pudo procesar la solicitud: ${error.message}`);
  }
});

$('#p-avatar').addEventListener('change', () => {
  const f = $('#p-avatar').files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { $('#avatar-preview').innerHTML = `<img src="${esc(urlImagen(r.result))}" alt="">`; };
  r.readAsDataURL(f);
});

$('#form-perfil').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#btn-guardar-perfil'); btn.disabled = true;
  const msg = $('#perfil-msg');
  try {
    let avatar_url = miPerfil?.avatar_url || null;
    const f = $('#p-avatar').files[0];
    if (f) avatar_url = await subirFoto(await procesarImagen(f, 360), `avatares/${usuario.id}/avatar.jpg`);
    const { error } = await db.from('vendedores').upsert({
      id: usuario.id,
      negocio: $('#p-negocio').value.trim(),
      responsable: $('#p-responsable').value.trim(),
      descripcion: $('#p-descripcion').value.trim() || null,
      whatsapp: soloDigitos($('#p-whats').value),
      categoria: $('#p-categoria').value,
      direccion: $('#p-direccion').value.trim() || null,
      avatar_emoji: $('#p-emoji').value.trim() || '',
      avatar_url
    });
    if (error) throw error;
    await cargarPerfil(); pintarZonaUsuario();
    await cargarDatos();
    msg.hidden = false; msg.className = 'modal-nota msg-ok'; msg.textContent = '✅ Perfil guardado. Tu tienda ya aparece en la vitrina.';
    setTimeout(() => msg.hidden = true, 3000);
  } catch (er) {
    msg.hidden = false; msg.className = 'modal-nota msg-error'; msg.textContent = 'No se pudo guardar: ' + er.message;
  }
  btn.disabled = false;
});

/* ---------- Panel: fotos del producto ---------- */
$('#g-fotos').addEventListener('change', e => {
  const archivos = [...e.target.files].filter(f => f.type.startsWith('image/'));
  for (const f of archivos) {
    if (fotosNuevas.length >= MAX_FOTOS) break;
    fotosNuevas.push({ file: f, preview: URL.createObjectURL(f) });
  }
  e.target.value = '';
  pintarFotosNuevas();
});

function pintarFotosNuevas() {
  $('#fotos-preview').innerHTML = fotosNuevas.map((f, i) => `<div class="foto-preview"> <img src="${esc(urlImagen(f.preview))}" alt="Foto ${i + 1}"> <button type="button" class="foto-quitar" data-quitar="${i}" aria-label="Quitar foto ${i + 1}">✕</button> </div>`).join('');
  $('#g-fotos-label').textContent = fotosNuevas.length
    ? `${fotosNuevas.length} foto(s) lista(s) · elegir más`
    : ' Elegir fotos del producto';
}

$('#fotos-preview').addEventListener('click', e => {
  const b = e.target.closest('[data-quitar]'); if (!b) return;
  URL.revokeObjectURL(fotosNuevas[+b.dataset.quitar].preview);
  fotosNuevas.splice(+b.dataset.quitar, 1);
  pintarFotosNuevas();
});

const MAX_ETIQUETAS = 5;
let etiquetasSeleccionadas = [];
function pintarOpcionesEtiquetas() {
  const query = normalizar($('#g-etiqueta-buscar').value.trim());
  const opciones = ETIQUETAS_DISPONIBLES
    .filter(etiqueta => !etiquetasSeleccionadas.includes(etiqueta))
    .filter(etiqueta => !query || normalizar(etiqueta).includes(query));
  $('#g-etiqueta-opcion').innerHTML = opciones.length
    ? opciones.map(etiqueta => `<option value="${esc(etiqueta)}">${esc(etiqueta)}</option>`).join('')
    : '<option value="">No hay coincidencias</option>';
}
function pintarEtiquetasSeleccionadas() {
  $('#etiquetas-contador').textContent = `${etiquetasSeleccionadas.length}/${MAX_ETIQUETAS}`;
  $('#g-etiquetas-seleccionadas').innerHTML = etiquetasSeleccionadas.length
    ? etiquetasSeleccionadas.map(etiqueta => `<button type="button" class="etiqueta-elegida" data-quitar-etiqueta="${esc(etiqueta)}">${esc(etiqueta)} <span aria-hidden="true">×</span></button>`).join('')
    : '<span class="etiquetas-vacio">Todavía no has elegido etiquetas.</span>';
  $('#g-etiqueta-anadir').disabled = etiquetasSeleccionadas.length >= MAX_ETIQUETAS;
  pintarOpcionesEtiquetas();
}
$('#g-etiqueta-buscar').addEventListener('input', pintarOpcionesEtiquetas);
$('#g-etiqueta-anadir').addEventListener('click', () => {
  const etiqueta = $('#g-etiqueta-opcion').value;
  if (!etiqueta || etiquetasSeleccionadas.length >= MAX_ETIQUETAS) return;
  etiquetasSeleccionadas.push(etiqueta);
  $('#g-etiqueta-buscar').value = '';
  pintarEtiquetasSeleccionadas();
});
$('#g-etiquetas-seleccionadas').addEventListener('click', e => {
  const boton = e.target.closest('[data-quitar-etiqueta]');
  if (!boton) return;
  etiquetasSeleccionadas = etiquetasSeleccionadas.filter(etiqueta => etiqueta !== boton.dataset.quitarEtiqueta);
  pintarEtiquetasSeleccionadas();
});
pintarEtiquetasSeleccionadas();

/* ---------- Panel: publicar producto ---------- */
$('#form-producto').addEventListener('submit', async e => {
  e.preventDefault();
  if (!usuario) return abrirAuth('entrar');
  const btn = $('#btn-publicar'); btn.disabled = true;
  const msg = $('#producto-msg');
  try {
    if (!miPerfil) throw new Error('Primero guarda tu perfil de vendedor (sección 1).');
    const fotos = [];
    for (let i = 0; i < fotosNuevas.length; i++) {
      const blob = await procesarImagen(fotosNuevas[i].file);
      fotos.push(await subirFoto(blob, `productos/${usuario.id}/${Date.now()}-${i}.jpg`));
    }
    const tags = [...etiquetasSeleccionadas];
    if (tags.length > MAX_ETIQUETAS) throw new Error(`Selecciona como máximo ${MAX_ETIQUETAS} etiquetas.`);
    const payload = {
      vendedor_id: usuario.id,
      nombre: $('#g-nombre').value.trim(),
      detalle: $('#g-detalle').value.trim() || null,
      categoria: $('#g-categoria').value,
      precio: parseFloat($('#g-precio').value) || 0,
      fotos,
      emoji: EMOJI_CAT[$('#g-categoria').value] || '🛒',
      tags
    };
    const { data: creado, error } = await db.from('productos').insert(payload);
    if (error) throw error;
    await cargarDatos();
    const productoCreado = creado || productos
      .filter(producto => producto.vendedor_id === usuario.id && producto.nombre === payload.nombre)
      .sort((a, b) => new Date(b.creado_en || 0) - new Date(a.creado_en || 0))[0];
    if (productoCreado && tags.length) {
      guardarProductoLocal({ ...productoCreado, tags });
      await cargarDatos();
    }
    fotosNuevas.forEach(f => URL.revokeObjectURL(f.preview));
    fotosNuevas = []; pintarFotosNuevas();
    e.target.reset();
    etiquetasSeleccionadas = [];
    pintarEtiquetasSeleccionadas();
    msg.hidden = false; msg.className = 'modal-nota msg-ok'; msg.textContent = '✅ Producto publicado en la vitrina.';
    setTimeout(() => msg.hidden = true, 3000);
  } catch (er) {
    msg.hidden = false; msg.className = 'modal-nota msg-error'; msg.textContent = 'No se pudo publicar: ' + er.message;
  }
  btn.disabled = false;
});

/* ---------- Panel: mis productos ---------- */
function pintarMisProductos() {
  const cont = $('#lista-mis-productos');
  if (!usuario) { cont.innerHTML = ''; return; }
  const mios = productos.filter(p => p.vendedor_id === usuario.id);
  cont.innerHTML = mios.length ? mios.map(p => {
    const thumb = (Array.isArray(p.fotos) && p.fotos.length)
      ? `<img src="${esc(urlImagen(p.fotos[0]))}" alt="">` : (p.emoji || '🛒');
    return `<div class="mini-item">
      <span class="mini-thumb">${thumb}</span>
      <strong>${esc(p.nombre)}<small>S/ ${fmtPrecio(p.precio)} · ${esc(p.categoria)} · ${(p.fotos || []).length} foto(s)</small></strong>
      <select class="select-destacado" data-destacado-plan="${p.id}" aria-label="Duración del destacado">
        <option value="7">7 días · S/ 10</option>
        <option value="15">15 días · S/ 18</option>
        <option value="30">30 días · S/ 30</option>
      </select>
      <button type="button" class="boton-destacar" data-solicitar-destacado="${p.id}">Solicitar destacado</button>
      <button type="button" class="boton-peligro" data-borrar="${p.id}">Eliminar</button>
    </div>`;
  }).join('') : '<p class="producto-detalle">Aún no publicas productos. Usa el formulario de arriba. 🌿</p>';
}

$('#lista-mis-productos').addEventListener('click', async e => {
  const solicitar = e.target.closest('[data-solicitar-destacado]');
  if (solicitar) {
    const selector = document.querySelector(`[data-destacado-plan="${solicitar.dataset.solicitarDestacado}"]`);
    solicitarDestacado(solicitar.dataset.solicitarDestacado, usuario.id, selector.value);
    return;
  }
  const b = e.target.closest('[data-borrar]'); if (!b) return;
  if (!confirm('¿Eliminar este producto de la vitrina?')) return;
  const p = productos.find(x => x.id === b.dataset.borrar);
  await db.from('productos').delete().eq('id', b.dataset.borrar).eq('vendedor_id', usuario.id);
  if (p && Array.isArray(p.fotos) && p.fotos.length) {
    const rutas = p.fotos.map(u => decodeURIComponent((u.split('/fotos/')[1] || ''))).filter(Boolean);
    if (rutas.length && db.storage) await db.storage.from('fotos').remove(rutas);
  }
  await cargarDatos();
});

function renderizarReseñas() {
  const cont = $('#testimonio-contenedor');
  if (intervaloTestimonios) clearInterval(intervaloTestimonios);
  intervaloTestimonios = null;
  const pendientes = (readLocalState().reseñas || []).filter(r => r.aprobado);
  if (!pendientes.length) {
    $('#testimonio-puntos').innerHTML = '';
    $('#testimonio-anterior').hidden = true;
    $('#testimonio-siguiente').hidden = true;
    cont.innerHTML = '<div class="testimonio-slide activo"><blockquote>"La mejor manera de comprar es apoyar a quienes producen cerca de casa."</blockquote><p class="testimonio-autor">DE NUESTRA TIERRA</p></div>';
    return;
  }
  const slides = pendientes.map(r => `
    <div class="testimonio-slide">
      <blockquote>"${esc(r.texto)}"</blockquote>
      <p class="testimonio-autor">${esc(r.nombre)} · ${esc(r.negocio)}</p>
    </div>
  `).join('');
  cont.innerHTML = slides;
  const puntos = $('#testimonio-puntos');
  $('#testimonio-anterior').hidden = false;
  $('#testimonio-siguiente').hidden = false;
  puntos.innerHTML = pendientes.map((_, i) => `<button type="button" data-testimonio="${i}" class="${i === 0 ? 'activo' : ''}" aria-label="Reseña ${i + 1}"></button>`).join('');
  let slideActual = 0;
  const mostrarSlide = idx => {
    const items = [...cont.querySelectorAll('.testimonio-slide')];
    items.forEach((item, pos) => item.classList.toggle('activo', pos === idx));
    puntos.querySelectorAll('button').forEach((btn, i) => btn.classList.toggle('activo', i === idx));
  };
  const anterior = () => {
    slideActual = (slideActual - 1 + pendientes.length) % pendientes.length;
    mostrarSlide(slideActual);
  };
  const siguiente = () => {
    slideActual = (slideActual + 1) % pendientes.length;
    mostrarSlide(slideActual);
  };
  puntos.onclick = e => {
    const btn = e.target.closest('[data-testimonio]'); if (!btn) return;
    slideActual = Number(btn.dataset.testimonio); mostrarSlide(slideActual);
  };
  $('#testimonio-anterior').onclick = anterior;
  $('#testimonio-siguiente').onclick = siguiente;
  intervaloTestimonios = setInterval(siguiente, INTERVALO_TESTIMONIO);
}

$('#form-reseña').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#reseña-msg');
  const payload = {
    nombre: $('#r-nombre').value.trim(),
    negocio: $('#r-negocio').value.trim(),
    texto: $('#r-comentario').value.trim(),
    aprobado: false
  };
  if (!payload.nombre || !payload.negocio || !payload.texto) {
    msg.hidden = false; msg.className = 'modal-nota msg-error'; msg.textContent = 'Completa todos los campos.';
    return;
  }
  const state = readLocalState();
  state.reseñas.unshift({ id: `r-${Date.now()}`, ...payload });
  writeLocalState(state);
  msg.hidden = false; msg.className = 'modal-nota msg-ok'; msg.textContent = 'Gracias. Tu reseña fue enviada para revisión de administración.';
  e.target.reset();
  renderizarReseñas();
});

function actualizarSlogan() {
  const el = $('#slogan-rotativo');
  if (!el) return;
  const hora = new Date().getHours();
  const horario = hora >= 6 && hora < 12 ? 'mañana' : hora >= 12 && hora < 18 ? 'tarde' : 'noche';
  const frases = frasesPorHorario[horario];
  let indice = Number(el.dataset.fraseIndice || 0);
  el.textContent = frases[indice % frases.length];
  el.dataset.fraseIndice = String((indice + 1) % frases.length);
}

actualizarSlogan();
setInterval(actualizarSlogan, INTERVALO_SLOGAN);
renderizarReseñas();

$('#pie-subir').addEventListener('click', e => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---------- Cierre de modales ---------- */
$$('dialog [data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

/* ---------- Arranque ---------- */
pintarZonaUsuario();
setInterval(revisarExpiraciones, 60 * 1000);
db.auth.getSession().then(async ({ data }) => {
  usuario = data.session?.user || null;
  await cargarPerfil();
  pintarZonaUsuario();
  await cargarDatos();
});

console.log('%c🏞️ DE NUESTRA TIERRA %c vitrina local viva', 'font-weight:bold;font-size:14px', 'color:#2e4b3c');
})();