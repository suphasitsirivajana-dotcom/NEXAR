// NEXAR default settings, UniFormat II Family placement catalog & feature flags.
// Bump APP_VERSION together with VERSION in sw.js on every release.
import { UNIFORMAT_L1, UNIFORMAT_L2, UNIFORMAT_CATALOG } from './uniformat.js';

export const APP_VERSION = '2.7.0';
export const CATALOG_VERSION = 2;

export const SETTINGS_KEY = 'nexar.settings';
export const LAST_KEY = 'nexar.lastProject';

// Location features (GPS, step tracking, QR control points, tripod, Walk&Mark, AR overlay) are SHELVED for now.
// All the code is still here — set this to true to bring every button back.
export const LOCATION_FEATURES = false;

export const UNIFORMAT_GROUPS = UNIFORMAT_L1;
export { UNIFORMAT_L2 };
export const DEFAULT_FAMILY_PRESETS = UNIFORMAT_CATALOG;

export const DEFAULT_SETTINGS = {
  // General
  author: '',
  uiMode: 'clean',         // 'clean' (Touch-First Field UI) | 'ribbon' (Classic Desktop Ribbon)
  inputMode: 'type',       // 'type' (Keyboard) | 'pencil' (Apple Pencil Scribble Pad)
  units: 'm',              // 'm' | 'mm' | 'cm' | 'ft'
  precision: 2,            // 1 | 2 | 3
  // Appearance
  theme: 'dark',           // 'dark' | 'light' | 'system'
  accent: 'yellow',        // 'yellow' | 'blue' | 'emerald' | 'mono'
  density: 'standard',     // 'standard' | 'compact' | 'touch'
  showCompass: true,
  grid: true,
  showMarkups: true,
  pinScale: 1.0,           // 0.75 | 1.0 | 1.3
  // Navigation & Controls
  mousePreset: 'nexar',    // 'nexar' (Web) | 'revit' | 'sketchup'
  touchControls: 'auto',   // 'auto' (iPad/Touch) | 'always' (Show on PC too) | 'off'
  invertZoom: false,
  orbitSpeed: 1.0,
  zoomSpeed: 1.0,
  invertLookY: false,
  eye: 1.6,
  scope: true,
  scopeFactor: 3,
  // Graphics & AR
  quality: 'high',         // 'high' (2x) | 'balanced' (1.5x) | 'lite' (1x)
  fov3d: 55,
  camFov: 45,
  arOpacity: 0.75,
  camOpacity: 0.6,
  gpsAvg: 8,
  stepLen: 0.7,
  stepSens: 0.8,
  trackMode: 'hybrid',
  qrSize: 0.2,
  showTrack: true,
  // Site-to-Revit Family presets (null = use DEFAULT_FAMILY_PRESETS)
  familyPresets: null
};
