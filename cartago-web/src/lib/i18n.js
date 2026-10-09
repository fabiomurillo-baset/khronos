const STRINGS = {
  es: {
    appTitle: 'Geno',
    appSubtitle: 'Protocolos de Cartago · 1540–1839',
    viewMap: 'Mapa',
    viewTimeline: 'Cronología',
    viewGraph: 'Red',
    switchLang: 'English',
    about: 'Cómo se hizo',
    aboutUrl: 'https://fabiomurillo.com/blog/geno-protocolos-de-cartago/',
    loading: 'Cargando registros…',
    loadingText: 'Cargando textos…',
    loadError: 'No se pudieron cargar los datos.',
    retry: 'Reintentar',
    events: 'eventos',
    event: 'evento',
    year: 'Año',
    inferredYear: 'año inferido del registro anterior',
    undated: 'Sin fecha',
    people: 'Personas',
    places: 'Lugares',
    noTranslation: 'Resumen original en inglés (traducción pendiente)',
    // map
    mapTitle: 'Geografía histórica',
    located: 'ubicados en el mapa',
    unlocated: 'sin ubicación conocida',
    windowLabel: 'Ventana',
    windowExact: 'Solo este año',
    windowAll: 'Todos los años',
    windowYears: (n) => `± ${n} años`,
    play: 'Reproducir',
    pause: 'Pausar',
    includeInferred: 'Incluir años inferidos',
    sliderHelp: 'Arrastre el control o use ← → para recorrer los años',
    eventsHere: (n) => `${n} eventos en este lugar`,
    prev: 'Anterior',
    next: 'Siguiente',
    close: 'Cerrar',
    zoomIn: 'Acercar para separar',
    approxLocation: 'Coordenadas aproximadas del asentamiento histórico',
    // timeline
    timelineTitle: 'Cronología',
    timelineSubtitle: 'Registros en orden de aparición en el índice',
    searchPlaceholder: 'Buscar personas, lugares o texto…',
    results: (n) => `${n} resultados`,
    noResults: 'Ningún registro coincide con la búsqueda.',
    allDecades: 'Todas',
    showOnMap: 'Ver en el mapa',
    showInGraph: 'Ver en la red',
    loadMore: 'Cargar más',
    clear: 'Limpiar',
    // graph
    graphTitle: 'Red de personas',
    graphSubtitle: 'Personas que aparecen juntas en un mismo registro',
    graphSearch: 'Buscar una persona…',
    graphTop: (n) => `Mostrando las ${n} personas más conectadas`,
    graphEgo: (name, n) => `Red de ${name} · ${n} personas`,
    connections: 'Conexiones',
    appearsIn: (n) => `Aparece en ${n} registros`,
    reset: 'Ver las más conectadas',
    graphHint: 'Haga clic en un nodo para ver sus registros. Arrastre para reorganizar.',
    footer: 'Fuente: Índice de los Protocolos de Cartago, Archivo Nacional de Costa Rica. Extracción asistida por IA; puede contener errores.',
  },
  en: {
    appTitle: 'Geno',
    appSubtitle: 'Cartago Notarial Records · 1540–1839',
    viewMap: 'Map',
    viewTimeline: 'Timeline',
    viewGraph: 'Network',
    switchLang: 'Español',
    about: 'How it was made',
    aboutUrl: 'https://fabiomurillo.com/en/blog/geno-protocolos-de-cartago/',
    loading: 'Loading records…',
    loadingText: 'Loading texts…',
    loadError: 'The data could not be loaded.',
    retry: 'Retry',
    events: 'events',
    event: 'event',
    year: 'Year',
    inferredYear: 'year inferred from the previous entry',
    undated: 'Undated',
    people: 'People',
    places: 'Places',
    noTranslation: 'Original English summary',
    mapTitle: 'Historical geography',
    located: 'placed on the map',
    unlocated: 'without a known location',
    windowLabel: 'Window',
    windowExact: 'This year only',
    windowAll: 'All years',
    windowYears: (n) => `± ${n} years`,
    play: 'Play',
    pause: 'Pause',
    includeInferred: 'Include inferred years',
    sliderHelp: 'Drag the slider or use ← → to step through the years',
    eventsHere: (n) => `${n} events at this place`,
    prev: 'Previous',
    next: 'Next',
    close: 'Close',
    zoomIn: 'Zoom in to separate',
    approxLocation: 'Approximate coordinates of the historical settlement',
    timelineTitle: 'Timeline',
    timelineSubtitle: 'Records in the order they appear in the index',
    searchPlaceholder: 'Search people, places or text…',
    results: (n) => `${n} results`,
    noResults: 'No records match your search.',
    allDecades: 'All',
    showOnMap: 'Show on map',
    showInGraph: 'Show in network',
    loadMore: 'Load more',
    clear: 'Clear',
    graphTitle: 'People network',
    graphSubtitle: 'People who appear together in the same record',
    graphSearch: 'Search for a person…',
    graphTop: (n) => `Showing the ${n} most connected people`,
    graphEgo: (name, n) => `${name}'s network · ${n} people`,
    connections: 'Connections',
    appearsIn: (n) => `Appears in ${n} records`,
    reset: 'Show most connected',
    graphHint: 'Click a node to see its records. Drag to rearrange.',
    footer: 'Source: Index of the Cartago Notarial Protocols, National Archive of Costa Rica. AI-assisted extraction; may contain errors.',
  },
}

export function t(lang, key, ...args) {
  const value = STRINGS[lang]?.[key] ?? STRINGS.es[key] ?? key
  return typeof value === 'function' ? value(...args) : value
}

/** Spanish is the default for every basetlabs.com app; an explicit choice (the toggle) is remembered. */
export function detectLanguage() {
  try {
    const saved = localStorage.getItem('geno.lang')
    if (saved === 'es' || saved === 'en') return saved
  } catch {
    /* storage unavailable */
  }
  return 'es'
}

export function persistLanguage(lang) {
  try {
    localStorage.setItem('geno.lang', lang)
  } catch {
    /* storage unavailable */
  }
}
