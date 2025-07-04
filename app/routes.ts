import { remixRoutesOptionAdapter } from '@react-router/remix-routes-option-adapter';
import { flatRoutes } from 'remix-flat-routes';

export default remixRoutesOptionAdapter((defineRotue) =>
  flatRoutes('routes', defineRotue, {
    ignoredRouteFiles: ['**/index.ts', '**/_shared/**'],
  })
) as ReturnType<typeof remixRoutesOptionAdapter>;
