export const DB_TARGET_RULES = [
  {
    classification: "PREVIEW",
    envSourcePatterns: [/\.env\.preview$/i, /\.env\.vercel\.(preview|development)$/i],
    hostPatterns: [/preview/i, /pr-\d+/i, /branch/i],
  },
  {
    classification: "PROD",
    envSourcePatterns: [/\.env\.prod$/i, /\.env\.vercel$/i],
    hostPatterns: [/prod/i, /production/i, /main/i],
  },
  {
    classification: "DEV",
    envSourcePatterns: [/\.env\.dev$/i, /\.env\.local$/i],
    hostPatterns: [/dev/i, /development/i, /local/i],
  },
];
