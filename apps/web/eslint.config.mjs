import next from "eslint-config-next/core-web-vitals";

const config = [
  ...next,
  {
    rules: {
      // Синхронизация с localStorage и пропсами при монтировании — осознанный паттерн; держим как предупреждение
      "react-hooks/set-state-in-effect": "warn",
      // Date.now() в фильтрах «сегодня / просрочено» — время намеренно берётся в момент рендера
      "react-hooks/purity": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];
export default config;
