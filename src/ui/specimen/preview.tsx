// Boots the real report app on the example fixture for the D2 screen baselines.
import './preview-boot';
import '../app/main';
import { keymapOpen, paletteOpen } from '../app/store';

const overlay = new URLSearchParams(location.search).get('overlay');
if (overlay === 'palette') paletteOpen.value = true;
if (overlay === 'keymap') keymapOpen.value = true;
