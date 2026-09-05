export type UiLanguage = "en" | "mr" | "hi";

export const UI_LANGUAGES: { code: UiLanguage; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
];

const UI_COPY: Record<UiLanguage, Record<string, string>> = {
  en: {},
  mr: {
    Dashboard: "डॅशबोर्ड", "Text Translate": "मजकूर भाषांतर", "Audio / Video": "ध्वनी / व्हिडिओ",
    "Chat with Document": "दस्तऐवजाशी संभाषण", Summary: "सारांश", "Format Convert": "स्वरूप बदल",
    Glossary: "शब्दकोश", History: "इतिहास", Models: "प्रारूपे", "Fine-tune": "फाइन-ट्यून", Settings: "सेटिंग्ज",
    Text: "मजकूर", Video: "व्हिडिओ", Audio: "ऑडिओ", Documents: "दस्तऐवज", Convert: "रूपांतर",
  },
  hi: {
    Dashboard: "डैशबोर्ड", "Text Translate": "पाठ अनुवाद", "Audio / Video": "ऑडियो / वीडियो",
    "Chat with Document": "दस्तावेज़ से बातचीत", Summary: "सारांश", "Format Convert": "प्रारूप बदलें",
    Glossary: "शब्दावली", History: "इतिहास", Models: "मॉडल", "Fine-tune": "फाइन-ट्यून", Settings: "सेटिंग्स",
    Text: "पाठ", Video: "वीडियो", Audio: "ऑडियो", Documents: "दस्तावेज़", Convert: "रूपांतरण",
  },
};

export const uiText = (language: UiLanguage, value: string): string => UI_COPY[language][value] ?? value;
