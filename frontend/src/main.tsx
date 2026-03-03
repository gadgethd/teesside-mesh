import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { App } from './App.js';
import { Layout } from './pages/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { AboutPage } from './pages/AboutPage.js';
import { InstallPage } from './pages/InstallPage.js';
import { OpenSourcePage } from './pages/OpenSourcePage.js';
import { MqttPage } from './pages/MqttPage.js';
import { StatsPage } from './pages/StatsPage.js';
import { PacketsPage } from './pages/PacketsPage.js';
import './styles/globals.css';

const root = document.getElementById('root')!;
const { hostname } = window.location;
const APP_HOSTNAME = import.meta.env['VITE_APP_HOSTNAME'];
const isAppDomain = !APP_HOSTNAME || hostname === APP_HOSTNAME;

document.title = isAppDomain ? 'MeshCore Analytics' : 'Teesside Mesh';

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {isAppDomain ? (
      <App />
    ) : (
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="install" element={<InstallPage />} />
            <Route path="mqtt" element={<MqttPage />} />
            <Route path="open-source" element={<OpenSourcePage />} />
            <Route path="packets" element={<PacketsPage />} />
            <Route path="stats" element={<StatsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    )}
  </React.StrictMode>
);
