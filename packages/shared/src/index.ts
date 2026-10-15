// Ponto único de entrada do pacote. Imports sem extensão: o consumo é sempre por
// bundler (esbuild no backend, Vite/Astro no site, Vitest nos testes).
export * from "./dominio/datas";
export * from "./dominio/precos";
export * from "./dominio/disponibilidade";
export * from "./dominio/casas";
export * from "./dominio/configGeral";
export * from "./dominio/formato";
export * from "./comodidades";
export * from "./schemas/comum";
export * from "./schemas/precos";
export * from "./schemas/cotacao";
export * from "./schemas/disponibilidade";
export * from "./schemas/casa";
