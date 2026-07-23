import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { Shell } from './components/layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { OrganizationsList } from './pages/OrganizationsList';
import { OrganizationDetail } from './pages/OrganizationDetail';
import { WorkforceBrowser } from './pages/WorkforceBrowser';
import { SystemStatus } from './pages/SystemStatus';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/organizations" component={OrganizationsList} />
        <Route path="/organizations/:id" component={OrganizationDetail} />
        <Route path="/workforce" component={WorkforceBrowser} />
        <Route path="/system" component={SystemStatus} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
