import { createRoot } from 'react-dom/client';

import App from './App';
import { webBuildIdentity } from './lib/webBuildIdentity';

import './index.css';

window.__NEEDSOPS_WEB_BUILD__ = webBuildIdentity;
document.documentElement.dataset.needsopsEnv = webBuildIdentity.environment;

createRoot(document.getElementById('root')!).render(<App />);
