/* ============================================================
CASERITO · script.js
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

  /* ---------- Utilidades ---------- */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const normalizar = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const soloDigitos = s => (s || '').replace(/\D/g, '');
  const fmtPrecio   = n => (+n).toFixed(2).replace(/\.00$/, '');
  const espera      = (fn, ms = 220) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  document.head.insertAdjacentHTML('beforeend', '<style>[hidden]{display:none!important}</style>');

  if (!window.supabase || SUPABASE_URL.includes('TU-PROYECTO')) {
    const aviso = $('#aviso');
    if (aviso) aviso.textContent = '⚙️ Falta conectar la base de datos: escribe tu URL y clave de Supabase al inicio de script.js.';
    return;
  }
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* ---------- Estado ---------- */
  let productos = [], vendedores = {}, usuario = null, miPerfil = null;
  let fotosNuevas = [];                 // fotos elegidas, aún sin publicar
  let carruselFotos = [], carruselIndex = 0, detalleEmoji = '🛒';
  const MAX_FOTOS = 6;
  const estado = { filtro: 'todos', busqueda: '', orden: 'recientes' };

  const EMOJI_CAT = {
    Alimentos: '🛒', 'Lácteos': '🧀', 'Panadería': '🥖',
    Agro: '🥔', 'Artesanía': '👒', Textiles: '🧶', Otro: '🛍️'
  };

  const listaProductos  = $('#lista-productos');
  const tiendaProductos = $('#tienda-productos');
  const listaVendedores = $('#lista-vendedores');
  const conteo          = $('#conteo-productos');
  const sinResultados   = $('#sin-resultados');
  const buscador        = $('#buscador');
  const zona            = $('#zona-usuario');
  const modalAuth    = $('#modal-auth');
  const modalPanel   = $('#modal-panel');
  const modalDetalle = $('#modal-producto');
  const modalTienda  = $('#modal-tienda');

  /* ---------- Carga de datos ---------- */
  async function cargarDatos() {
    const [p, v] = await Promise.all([
      db.from('productos').select('*').order('creado_en', { ascending: false }),
      db.from('vendedores').select('*')
    ]);
    productos  = p.data || [];
    vendedores = Object.fromEntries((v.data || []).map(x => [x.id, x]));
    pintarVitrina(); pintarVendedores(); pintarMetricas();
    if (usuario) pintarMisProductos();
  }

  /* ---------- Tarjeta de producto ---------- */
  function tarjetaProducto(p) {
    const v = vendedores[p.vendedor_id] || {};
    const fotos = Array.isArray(p.fotos) ? p.fotos : [];
    const img = fotos.length
      ? `<img src="${fotos[0]}" alt="${esc(p.nombre)}" loading="lazy">`
      : `<span class="producto-emoji" aria-hidden="true">${p.emoji || EMOJI_CAT[p.categoria] || '🛒'}</span>`;
    const badgeFotos = fotos.length ? `<span class="producto-fotos">📷 ${fotos.length}</span>` : '';
    const destacado  = p.destacado ? '<span class="producto-destacado">Destacado</span>' : '';
    return `
    <article class="producto" data-id="${p.id}" tabindex="0" role="button" aria-label="Ver ${esc(p.nombre)}">
      <div class="producto-imagen">
        <span class="producto-etiqueta">${esc(p.categoria || 'Varios')}</span>
        ${destacado}${badgeFotos}${img}
      </div>
      <div class="producto-cuerpo">
        <h3>${esc(p.nombre)}</h3>
        ${p.detalle ? `<p class="producto-detalle">${esc(p.detalle)}</p>` : ''}
        <button type="button" class="producto-vendedor" data-tienda="${p.vendedor_id}">🏪 ${esc(v.negocio || 'Vendedor local')}</button>
        <div class="producto-pie">
          <span class="producto-precio">S/ ${fmtPrecio(p.precio)}</span>
          <button type="button" class="boton-wsp" data-pedir="${p.id}">
            <svg class="icono"><use href="#i-whatsapp"/></svg><span>Pedir</span>
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
      const porFiltro = estado.filtro === 'todos' || normalizar(p.categoria) === estado.filtro;
      const texto = normalizar(`${p.nombre} ${p.detalle || ''} ${p.categoria || ''} ${v.negocio || ''}`);
      return porFiltro && (!q || texto.includes(q));
    });
    const ord = {
      'recientes':   (a, b) => new Date(b.creado_en) - new Date(a.creado_en),
      'precio-asc':  (a, b) => a.precio - b.precio,
      'precio-desc': (a, b) => b.precio - a.precio,
      'nombre':      (a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')
    }[estado.orden];
    lista.sort(ord);
    listaProductos.innerHTML = lista.map(tarjetaProducto).join('');
    conteo.textContent = lista.length === 1
      ? '1 producto disponible, recién salido.'
      : `${lista.length} productos disponibles, recién salidos.`;
    sinResultados.hidden = lista.length > 0;
  }

  /* ---------- Vendedores ---------- */
  function pintarVendedores() {
    const iniciales = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    listaVendedores.innerHTML = Object.values(vendedores).map(v => {
      const n = productos.filter(p => p.vendedor_id === v.id).length;
      const av = v.avatar_url ? `<img src="${v.avatar_url}" alt="">` : esc(v.avatar_emoji || iniciales(v.negocio));
      const num = soloDigitos(v.whatsapp);
      return `
      <article class="vendedor">
        <span class="vendedor-avatar" aria-hidden="true">${av}</span>
        <div class="vendedor-datos">
          <h3>${esc(v.negocio)}</h3>
          <p>${esc(v.responsable || 'Vendedor local')} · ${esc(v.categoria || 'Varios')}</p>
          ${v.direccion ? `<p class="vendedor-direccion">📍 ${esc(v.direccion)}</p>` : ''}
          <small>${n} producto(s) en vitrina</small>
        </div>
        <div class="vendedor-acciones">
          <button type="button" class="boton boton--linea" data-tienda="${v.id}">Ver tienda</button>
          <a class="boton-wsp" target="_blank" rel="noopener" aria-label="Escribir a ${esc(v.negocio)}"
             href="https://wa.me/${num}?text=${encodeURIComponent(`Hola ${v.negocio}, vi tu tienda en Caserito.`)}">
            <svg class="icono"><use href="#i-whatsapp"/></svg>
          </a>
        </div>
      </article>`;
    }).join('') || '<p class="producto-detalle">Aún no hay tiendas registradas. ¡Sé la primera! 🌿</p>';
  }

  function pintarMetricas() {
    const cats = new Set(productos.map(p => p.categoria));
    $('[data-contador="productos"]').textContent  = productos.length;
    $('[data-contador="vendedores"]').textContent = Object.keys(vendedores).length;
    $('[data-contador="categorias"]').textContent = cats.size;
  }

  /* ---------- Interacción con tarjetas (delegación global) ---------- */
  function abrirWhatsAppProducto(id) {
    const p = productos.find(x => x.id === id); if (!p) return;
    const v = vendedores[p.vendedor_id] || {};
    const num = soloDigitos(v.whatsapp);
    const msg = encodeURIComponent(`Hola ${v.negocio || ''}, vi "${p.nombre}" en Caserito y quiero hacer un pedido.`);
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
    const num = soloDigitos(v.whatsapp);
    $('#detalle-wsp').href = `https://wa.me/${num}?text=${encodeURIComponent(`Hola ${v.negocio || ''}, vi "${p.nombre}" en Caserito y quiero hacer un pedido.`)}`;
    $('#detalle-vendedor-avatar').innerHTML = v.avatar_url ? `<img src="${v.avatar_url}" alt="">` : esc(v.avatar_emoji || '🏪');
    $('#detalle-vendedor-nombre').textContent = v.negocio || 'Vendedor local';
    $('#detalle-vendedor').dataset.tienda = p.vendedor_id;
    carruselFotos = Array.isArray(p.fotos) ? p.fotos : [];
    carruselIndex = 0;
    detalleEmoji  = p.emoji || EMOJI_CAT[p.categoria] || '🛒';
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
        `<div class="carrusel-slide"><img src="${f}" alt="Foto del producto" loading="lazy"></div>`).join('');
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
  /* Deslizar en móvil */
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
    $('#tienda-avatar').innerHTML = v.avatar_url ? `<img src="${v.avatar_url}" alt="">` : esc(v.avatar_emoji || '🏪');
    $('#tienda-nombre').textContent = v.negocio;
    $('#tienda-responsable').textContent = v.responsable ? `Atiende: ${v.responsable}` : '';
    $('#tienda-direccion').textContent = v.direccion ? `📍 ${v.direccion}` : '📍 San Marcos, Cajamarca';
    $('#tienda-descripcion').textContent = v.descripcion || 'Este vendedor aún no agregó una descripción.';
    $('#tienda-categoria').textContent = v.categoria || 'Varios';
    const deTienda = productos.filter(p => p.vendedor_id === id);
    $('#tienda-conteo').textContent = `${deTienda.length} producto(s) en vitrina`;
    $('#tienda-wsp').href = `https://wa.me/${soloDigitos(v.whatsapp)}?text=${encodeURIComponent(`Hola ${v.negocio}, vi tu tienda en Caserito.`)}`;
    tiendaProductos.innerHTML = deTienda.map(tarjetaProducto).join('')
      || '<p class="producto-detalle">Aún no hay productos publicados.</p>';
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

  function pintarZonaUsuario() {
    if (usuario && miPerfil) {
      const av = miPerfil.avatar_url ? `<img src="${miPerfil.avatar_url}" alt="">` : esc(miPerfil.avatar_emoji || '🏪');
      zona.innerHTML = `
        <button type="button" class="chip chip-avatar chip--activo" data-accion="panel" title="Administrar mi tienda">
          <span>${av}</span>${esc(miPerfil.negocio || 'Mi tienda')}
        </button>
        <button type="button" class="boton boton--linea" data-accion="salir">Salir</button>`;
    } else if (usuario) {
      zona.innerHTML = `<button type="button" class="boton boton--ambar" data-accion="panel">Completar mi perfil</button>`;
    } else {
      zona.innerHTML = `
        <button type="button" class="boton boton--linea" data-accion="entrar">Entrar</button>
        <button type="button" class="boton boton--ambar" data-accion="crear">Vender aquí</button>`;
    }
  }

  zona.addEventListener('click', e => {
    const a = e.target.closest('[data-accion]'); if (!a) return;
    const acc = a.dataset.accion;
    if (acc === 'entrar') abrirAuth('entrar');
    if (acc === 'crear')  abrirAuth('crear');
    if (acc === 'salir')  db.auth.signOut();
    if (acc === 'panel')  abrirPanel();
  });

  db.auth.onAuthStateChange((_ev, ses) => {
    usuario = ses?.user || null;
    cargarPerfil().then(() => { pintarZonaUsuario(); if (usuario) pintarMisProductos(); });
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
    $('#form-crear').hidden  = tab !== 'crear';
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

  $('#form-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    const { error } = await db.auth.signInWithPassword({
      email: $('#e-email').value.trim(), password: $('#e-pass').value
    });
    btn.disabled = false;
    if (error) return errAuth(traducir(error.message));
    modalAuth.close(); e.target.reset();
  });

  $('#form-crear').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    $('#auth-error').hidden = true;
    try {
      const { data, error } = await db.auth.signUp({
        email: $('#c-email').value.trim(),
        password: $('#c-pass').value,
        options: { data: { negocio: $('#c-negocio').value.trim() } }
      });
      if (error) throw new Error(traducir(error.message));
      if (!data.session) {
        errAuth('Cuenta creada ✅ Revisa tu correo para confirmarla y luego entra con "Ya tengo cuenta".', true);
        btn.disabled = false; return;
      }
      usuario = data.session.user;
      await db.from('vendedores').upsert({
        id: usuario.id,
        negocio: $('#c-negocio').value.trim(),
        responsable: $('#c-responsable').value.trim(),
        whatsapp: soloDigitos($('#c-whats').value),
        categoria: $('#c-categoria').value
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
    if (miPerfil) {
      $('#p-negocio').value     = miPerfil.negocio || '';
      $('#p-responsable').value = miPerfil.responsable || '';
      $('#p-descripcion').value = miPerfil.descripcion || '';
      $('#p-whats').value       = miPerfil.whatsapp || '';
      $('#p-categoria').value   = miPerfil.categoria || 'Alimentos';
      $('#p-direccion').value   = miPerfil.direccion || '';
      $('#p-emoji').value       = miPerfil.avatar_emoji || '';
      $('#avatar-preview').innerHTML = miPerfil.avatar_url
        ? `<img src="${miPerfil.avatar_url}" alt="">`
        : esc(miPerfil.avatar_emoji || '🏪');
      $('#p-avatar').value = '';
    }
    pintarMisProductos();
    modalPanel.showModal();
  }

  /* Vista previa de la foto de perfil */
  $('#p-avatar').addEventListener('change', () => {
    const f = $('#p-avatar').files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $('#avatar-preview').innerHTML = `<img src="${r.result}" alt="">`; };
    r.readAsDataURL(f);
  });

  /* Guardar perfil (crea o actualiza) */
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
        avatar_emoji: $('#p-emoji').value.trim() || '🏪',
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

  /* ---------- Panel: fotos del producto (antes de publicar) ---------- */
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
    $('#fotos-preview').innerHTML = fotosNuevas.map((f, i) => `
      <div class="foto-preview">
        <img src="${f.preview}" alt="Foto ${i + 1}">
        <button type="button" class="foto-quitar" data-quitar="${i}" aria-label="Quitar foto ${i + 1}">✕</button>
      </div>`).join('');
    $('#g-fotos-label').textContent = fotosNuevas.length
      ? `${fotosNuevas.length} foto(s) lista(s) · elegir más`
      : 'Elegir fotos del producto';
  }

  $('#fotos-preview').addEventListener('click', e => {
    const b = e.target.closest('[data-quitar]'); if (!b) return;
    URL.revokeObjectURL(fotosNuevas[+b.dataset.quitar].preview);
    fotosNuevas.splice(+b.dataset.quitar, 1);
    pintarFotosNuevas();
  });

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
      const { error } = await db.from('productos').insert({
        vendedor_id: usuario.id,
        nombre: $('#g-nombre').value.trim(),
        detalle: $('#g-detalle').value.trim() || null,
        categoria: $('#g-categoria').value,
        precio: parseFloat($('#g-precio').value) || 0,
        fotos,
        emoji: EMOJI_CAT[$('#g-categoria').value] || '🛒'
      });
      if (error) throw error;
      fotosNuevas.forEach(f => URL.revokeObjectURL(f.preview));
      fotosNuevas = []; pintarFotosNuevas();
      e.target.reset();
      msg.hidden = false; msg.className = 'modal-nota msg-ok'; msg.textContent = '✅ Producto publicado en la vitrina.';
      setTimeout(() => msg.hidden = true, 3000);
      await cargarDatos();
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
        ? `<img src="${p.fotos[0]}" alt="">` : (p.emoji || '🛒');
      return `<div class="mini-item">
        <span class="mini-thumb">${thumb}</span>
        <strong>${esc(p.nombre)}<small>S/ ${fmtPrecio(p.precio)} · ${esc(p.categoria)} · ${(p.fotos || []).length} foto(s)</small></strong>
        <button type="button" class="boton-peligro" data-borrar="${p.id}">Eliminar</button>
      </div>`;
    }).join('') : '<p class="producto-detalle">Aún no publicas productos. Usa el formulario de arriba. 🌿</p>';
  }

  $('#lista-mis-productos').addEventListener('click', async e => {
    const b = e.target.closest('[data-borrar]'); if (!b) return;
    if (!confirm('¿Eliminar este producto de la vitrina?')) return;
    const p = productos.find(x => x.id === b.dataset.borrar);
    await db.from('productos').delete().eq('id', b.dataset.borrar).eq('vendedor_id', usuario.id);
    if (p && Array.isArray(p.fotos) && p.fotos.length) {
      const rutas = p.fotos.map(u => decodeURIComponent((u.split('/fotos/')[1] || ''))).filter(Boolean);
      if (rutas.length) await db.storage.from('fotos').remove(rutas);
    }
    await cargarDatos();
  });

  /* ---------- Cierre de modales ---------- */
  $$('dialog [data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

  /* ---------- Arranque ---------- */
  pintarZonaUsuario();
  db.auth.getSession().then(async ({ data }) => {
    usuario = data.session?.user || null;
    await cargarPerfil();
    pintarZonaUsuario();
    await cargarDatos();
  });

  console.log('%c🧺 Caserito %c vitrina local viva', 'font-weight:bold;font-size:14px', 'color:#2e4b3c');
})();