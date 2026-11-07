import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  transpilePackages: ["@all/ui", "@all/db", "@all/dialog", "@all/integrations"],
  typedRoutes: false,
  poweredByHeader: false,
  devIndicators: false,
};

export default withNextIntl(config);
