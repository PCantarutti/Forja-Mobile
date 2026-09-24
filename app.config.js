// O google-services.json fica fora do git (tem a API key do Firebase). No build local ele está na raiz;
// no EAS vem da variável de arquivo GOOGLE_SERVICES_JSON (eas env:create --type file).
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android.googleServicesFile },
});
