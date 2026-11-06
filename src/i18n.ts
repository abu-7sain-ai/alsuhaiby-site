export const SITE = 'https://alsuhaiby.com';
export const DEFAULT_LANG = 'ar';

export type Lang = 'ar' | 'en' | 'fr' | 'es' | 'ur';

export const LANGS: Record<Lang, { dir: 'rtl' | 'ltr'; name: string; prefix: string; hreflang: string }> = {
  ar: { dir: 'rtl', name: 'العربية', prefix: '', hreflang: 'ar' },
  en: { dir: 'ltr', name: 'English', prefix: '/en', hreflang: 'en' },
  fr: { dir: 'ltr', name: 'Français', prefix: '/fr', hreflang: 'fr' },
  es: { dir: 'ltr', name: 'Español', prefix: '/es', hreflang: 'es' },
  ur: { dir: 'rtl', name: 'اردو', prefix: '/ur', hreflang: 'ur' },
};

export const OTHER_LANGS: Lang[] = ['en', 'fr', 'es', 'ur'];

// Identity: the exact same wording everywhere (constitution section 4).
export const PERSON = {
  ar: { name: 'محمد الصهيبي', job: 'ميكانيكي سيارات', garage: 'كراج الصهيبي' },
  en: { name: 'Mohammad Al-Suhaiby', job: 'Car mechanic', garage: 'Al-Suhaiby Garage' },
  fr: { name: 'Mohammad Al-Suhaiby', job: 'Mécanicien automobile', garage: 'Garage Al-Suhaiby' },
  es: { name: 'Mohammad Al-Suhaiby', job: 'Mecánico de coches', garage: 'Taller Al-Suhaiby' },
  ur: { name: 'محمد الصہیبی', job: 'کار مکینک', garage: 'الصہیبی گیراج' },
};

export const SOCIAL = {
  tiktok: 'https://www.tiktok.com/@m_alsuhaiby',
  instagram: 'https://www.instagram.com/mohammad_alsuhaiby/',
};

// Filled in by hand (empty = the page shows «[يُعبّى يدويًا]»). Only the garage number is published, never a personal one.
export const GARAGE = {
  location: '', // e.g. the area + a Google Maps link
  whatsapp: '', // digits only with country code, e.g. 965XXXXXXXX
};

const UI = {
  ar: {
    home: 'الرئيسية', topics: 'المواضيع', about: 'عن محمد', contact: 'تواصل', search: 'بحث',
    latest: 'آخر الفيديوهات', popular: 'أكثر المواضيع بحثًا', watch: 'شغّل الفيديو',
    otherPlatforms: 'نفس الفيديو على', otherVideos: 'فيديوهات أخرى عن نفس الموضوع',
    faq: 'أسئلة وأجوبة', related: 'فيديوهات مرتبطة', published: 'تاريخ النشر', updated: 'آخر تحديث',
    views: 'مشاهدة', searchPlaceholder: 'اكتب العطل اللي عندك… مثل: السيارة ترجف', noResults: 'ما لقينا شي، جرّب كلمة ثانية.',
    allTopics: 'كل المواضيع', bySystem: 'حسب نظام السيارة', byBrand: 'حسب الماركة', language: 'اللغة', summary: 'الخلاصة',
  },
  en: {
    home: 'Home', topics: 'Topics', about: 'About', contact: 'Contact', search: 'Search',
    latest: 'Latest videos', popular: 'Most searched topics', watch: 'Play video',
    otherPlatforms: 'Same video on', otherVideos: 'More videos on this topic',
    faq: 'Questions and answers', related: 'Related videos', published: 'Published', updated: 'Updated',
    views: 'views', searchPlaceholder: 'Describe your car problem…', noResults: 'Nothing found, try another word.',
    allTopics: 'All topics', bySystem: 'By car system', byBrand: 'By brand', language: 'Language', summary: 'In short',
  },
  fr: {
    home: 'Accueil', topics: 'Sujets', about: 'À propos', contact: 'Contact', search: 'Recherche',
    latest: 'Dernières vidéos', popular: 'Sujets les plus recherchés', watch: 'Lire la vidéo',
    otherPlatforms: 'Même vidéo sur', otherVideos: 'Autres vidéos sur ce sujet',
    faq: 'Questions et réponses', related: 'Vidéos liées', published: 'Publié le', updated: 'Mis à jour le',
    views: 'vues', searchPlaceholder: 'Décrivez la panne…', noResults: 'Aucun résultat, essayez un autre mot.',
    allTopics: 'Tous les sujets', bySystem: 'Par système', byBrand: 'Par marque', language: 'Langue', summary: 'En bref',
  },
  es: {
    home: 'Inicio', topics: 'Temas', about: 'Sobre mí', contact: 'Contacto', search: 'Buscar',
    latest: 'Últimos vídeos', popular: 'Temas más buscados', watch: 'Ver vídeo',
    otherPlatforms: 'El mismo vídeo en', otherVideos: 'Más vídeos sobre este tema',
    faq: 'Preguntas y respuestas', related: 'Vídeos relacionados', published: 'Publicado', updated: 'Actualizado',
    views: 'visualizaciones', searchPlaceholder: 'Describe la avería…', noResults: 'Sin resultados, prueba otra palabra.',
    allTopics: 'Todos los temas', bySystem: 'Por sistema', byBrand: 'Por marca', language: 'Idioma', summary: 'En resumen',
  },
  ur: {
    home: 'ہوم', topics: 'موضوعات', about: 'تعارف', contact: 'رابطہ', search: 'تلاش',
    latest: 'تازہ ویڈیوز', popular: 'سب سے زیادہ تلاش کیے گئے موضوعات', watch: 'ویڈیو چلائیں',
    otherPlatforms: 'یہی ویڈیو', otherVideos: 'اسی موضوع پر مزید ویڈیوز',
    faq: 'سوال و جواب', related: 'متعلقہ ویڈیوز', published: 'شائع', updated: 'تازہ کاری',
    views: 'ویوز', searchPlaceholder: 'گاڑی کا مسئلہ لکھیں…', noResults: 'کچھ نہیں ملا، دوسرا لفظ آزمائیں۔',
    allTopics: 'تمام موضوعات', bySystem: 'گاڑی کے نظام کے لحاظ سے', byBrand: 'برانڈ کے لحاظ سے', language: 'زبان', summary: 'خلاصہ',
  },
};

export function t(lang: Lang) {
  return UI[lang];
}

export function videoUrl(lang: Lang, slug: string) {
  return `${LANGS[lang].prefix}/${slug}/`;
}

export function homeUrl(lang: Lang) {
  return `${LANGS[lang].prefix}/`;
}

export function formatDate(d: Date, lang: Lang) {
  const loc = { ar: 'ar-KW-u-nu-latn', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', ur: 'ur-PK-u-nu-latn' }[lang];
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatViews(n: number, lang: Lang) {
  if (lang === 'ar') {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} مليون`;
    if (n >= 1000) return `${Math.round(n / 1000)} ألف`;
    return String(n);
  }
  return new Intl.NumberFormat(lang, { notation: 'compact' }).format(n);
}
