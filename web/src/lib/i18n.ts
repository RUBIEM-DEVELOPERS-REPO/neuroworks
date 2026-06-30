export type Language = "en" | "sn" | "nd";

const strings: Record<Language, Record<string, string>> = {
  en: {
    "app.title": "NeuroWorks",
    "app.tagline": "The AI Workforce",
    "app.subtitle": "Describe what you want done, delegate, get results.",
    "dashboard.welcome": "Welcome to",
    "dashboard.quickStart": "Quick start",
    "dashboard.quickStart.persona": "tasks tuned for",
    "dashboard.viewAll": "View all templates",
    "dashboard.hire": "Hire an employee",
    "dashboard.hire.active": "currently working as",
    "dashboard.hire.none": "no employee active",
    "dashboard.recentActivity": "Recent activity",
    "dashboard.noTasks": "No tasks yet. Pick one above to delegate something.",
    "dashboard.workforce": "Workforce",
    "dashboard.inputPlaceholder": "Describe your task — e.g., Summarize the scraper-hub project",
    "dashboard.delegate": "Delegate",
    "dashboard.routing": "Routing…",
    "dashboard.zimbabweContext": "Zimbabwe Context",
    "dashboard.zimbabweContextDesc": "Your AI workforce is tuned for the Zimbabwe market. Here's what you should know about your sector.",
    "onboarding.title": "Configure your AI Workforce",
    "onboarding.subtitle": "Help us tailor NeuroWorks to your needs",
    "onboarding.sector": "What sector do you operate in?",
    "onboarding.sectorDesc": "This helps us pre-configure templates, integrations, and knowledge packs for your industry.",
    "onboarding.language": "Preferred language",
    "onboarding.languageDesc": "Agents will communicate in this language by default.",
    "onboarding.language.en": "English",
    "onboarding.language.sn": "chiShona",
    "onboarding.language.nd": "isiNdebele",
    "onboarding.orgName": "Organization name",
    "onboarding.orgNamePlaceholder": "e.g., Rubiem Developers",
    "onboarding.finish": "Get started",
    "onboarding.next": "Next",
    "onboarding.back": "Back",
    "onboarding.skipped": "Skip for now",
    "onboarding.done": "Your AI Workforce is ready",
    "onboarding.doneDesc": "You can change these settings anytime in Settings.",
  },
  sn: {
    "app.title": "NeuroWorks",
    "app.tagline": "Vashandi veAI",
    "app.subtitle": "Taura zvausingade kuita, tumira, uwane mhinduro.",
    "dashboard.welcome": "Tinokugamuchira ku",
    "dashboard.quickStart": "Kutanga",
    "dashboard.quickStart.persona": "mabasa akarongedzerwa",
    "dashboard.viewAll": "Ona template dzese",
    "dashboard.hire": "Haya mushandi",
    "dashboard.hire.active": "parizvino ari kushanda se",
    "dashboard.hire.none": "hapana mushandi ari kushanda",
    "dashboard.recentActivity": "Zvaitika nguva pfupi yapfuura",
    "dashboard.noTasks": "Hapana mabasa achiri. Sarudza rimwe kuti upe rimwe basa.",
    "dashboard.workforce": "Vashandi",
    "dashboard.inputPlaceholder": "Rondedzera basa rako — semuenzaniso, Pfupisa chirongwa che scraper-hub",
    "dashboard.delegate": "Tumira",
    "dashboard.routing": "Kuronga…",
    "dashboard.zimbabweContext": "Mamiriro eZimbabwe",
    "dashboard.zimbabweContextDesc": "Vashandi vako veAI vakagadzirirwa musika weZimbabwe. Heichi chinhu chaunofanira kuziva nezve chikamu chako.",
    "onboarding.title": "Gadzirira Vashandi Vako veAI",
    "onboarding.subtitle": "Tibatsire kugadzirisa NeuroWorks zvinoenderana nezvaunoda",
    "onboarding.sector": "Uri mune chikamu chipi chebasa?",
    "onboarding.sectorDesc": "Izvi zvinotibatsira kugadzirira template, integrations, uye knowledge packs zvine chekuita nebasa rako.",
    "onboarding.language": "Mutauro waunofarira",
    "onboarding.languageDesc": "Vashandi vachataura mumutauro uyu nechisikigo.",
    "onboarding.language.en": "English",
    "onboarding.language.sn": "chiShona",
    "onboarding.language.nd": "isiNdebele",
    "onboarding.orgName": "Zita resangano",
    "onboarding.orgNamePlaceholder": "Semuenzaniso, Rubiem Developers",
    "onboarding.finish": "Tanga",
    "onboarding.next": "Inotevera",
    "onboarding.back": "Shure",
    "onboarding.skipped": "Ipfuura izvozvi",
    "onboarding.done": "Vashandi vako veAI vagadzirira",
    "onboarding.doneDesc": "Unogona kuchinja izvi nguva ipi neipi mu Settings.",
  },
  nd: {
    "app.title": "NeuroWorks",
    "app.tagline": "Abasebenzi beAI",
    "app.subtitle": "Chaza umsebenzi ofuna ukwenziwe, thuma, uthole iziphumo.",
    "dashboard.welcome": "Wamukelekile ku",
    "dashboard.quickStart": "Ukuqala",
    "dashboard.quickStart.persona": "imisebenzi elungiselelwe",
    "dashboard.viewAll": "Buka wonke ama-template",
    "dashboard.hire": "Qasha isisebenzi",
    "dashboard.hire.active": "okwamanje usebenza njengo",
    "dashboard.hire.none": "akukho sisebenzi esisebenzayo",
    "dashboard.recentActivity": "Umsebenzi wakamuva",
    "dashboard.noTasks": "Akukho misebenzi okwamanje. Khetha enye ukuze uthume umsebenzi.",
    "dashboard.workforce": "Abasebenzi",
    "dashboard.inputPlaceholder": "Chaza umsebenzi wakho — isib, Fingqa iphrojekthi ye-scraper-hub",
    "dashboard.delegate": "Thuma",
    "dashboard.routing": "Kuhlela…",
    "dashboard.zimbabweContext": "Isimo seZimbabwe",
    "dashboard.zimbabweContextDesc": "Abasebenzi bakho beAI balungiselelwe imakethe yaseZimbabwe. Nasi okufanele ukwazi ngesigaba sakho.",
    "onboarding.title": "Lungisa Abasebenzi Bakho beAI",
    "onboarding.subtitle": "Sisize silungise i-NeuroWorks ngokwezidingo zakho",
    "onboarding.sector": "Usebenza kusiphi isigaba?",
    "onboarding.sectorDesc": "Lokhu kusiza ukulungisa ama-template, izixhumanisi, kanye namaphakethe olwazi ngesigaba sakho.",
    "onboarding.language": "Ulimi oluthandayo",
    "onboarding.languageDesc": "Abasebenzi bazokhuluma ngalolu limi ngokwemvelo.",
    "onboarding.language.en": "English",
    "onboarding.language.sn": "chiShona",
    "onboarding.language.nd": "isiNdebele",
    "onboarding.orgName": "Igama lenhlangano",
    "onboarding.orgNamePlaceholder": "Isib, Rubiem Developers",
    "onboarding.finish": "Qala",
    "onboarding.next": "Okulandelayo",
    "onboarding.back": "Emuva",
    "onboarding.skipped": "Yeqa okwamanje",
    "onboarding.done": "Abasebenzi bakho beAI bakulungele",
    "onboarding.doneDesc": "Ungazishintsha lezi zilungiselelo noma inini kuma-Settings.",
  },
};

let currentLanguage: Language = "en";

export function setLanguage(lang: Language): void {
  currentLanguage = lang;
  try { localStorage.setItem("neuroworks.language", lang); } catch { }
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function loadSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem("neuroworks.language") as Language | null;
    if (saved && ["en", "sn", "nd"].includes(saved)) {
      currentLanguage = saved;
      return saved;
    }
  } catch { }
  return "en";
}

export function t(key: string, lang?: Language): string {
  const l = lang ?? currentLanguage;
  return strings[l]?.[key] ?? strings.en[key] ?? key;
}

export function availableLanguages(): { code: Language; name: string }[] {
  return [
    { code: "en", name: "English" },
    { code: "sn", name: "chiShona" },
    { code: "nd", name: "isiNdebele" },
  ];
}
