import React from 'react';
import {createRoot} from 'react-dom/client';
import {Preview} from './Preview';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview/></React.StrictMode>);
