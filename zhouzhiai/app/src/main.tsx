import React from 'react';
import { createRoot } from 'react-dom/client';
import { Preview } from './Preview';
import {PreviewSettings} from './PreviewSettings';
import {AdminMembers} from './AdminMembers';
import './styles.css';
import '../server/ui/scrollbars.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview SettingsView={PreviewSettings} MembersView={AdminMembers}/></React.StrictMode>);
