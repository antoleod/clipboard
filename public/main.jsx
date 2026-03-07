import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './context/AppProvider';
import Dashboard from './components/Dashboard';
import './styles/themes.css';

// You may need a global CSS file for TailwindCSS if you are using it.
// import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AppProvider>
            <Dashboard />
        </AppProvider>
    </React.StrictMode>,
);