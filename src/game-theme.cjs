'use strict';

// Selectors checked against HaxBall's public JPDEx8Ti game.css and site CSS.
// This stylesheet changes HTML chrome colors only. Team, warning, chat-message
// and recording colors remain owned by HaxBall. No game pixels are filtered.
const GAME_THEME_CSS = `
html, body {
  background-color: #000 !important;
  background-image: none !important;
  color: #fff;
  color-scheme: dark;
}
.header, .rightbar {
  background-color: #000 !important;
}
.header .title {
  background-color: #171717 !important;
  color: #fff !important;
}
.header .active, .header a:hover {
  color: #fff !important;
}
.dialog, .room-view > .container, .roomlist-view > .notice,
.game-view > .buttons, .game-state-view .bar, .game-state-view.restricted {
  background-color: #111 !important;
}
.dialog > h1, .room-view > .container > h1 {
  border-bottom-color: #fff !important;
}
.dialog .label-input, .room-view > .container .label-input {
  background-color: #242424 !important;
}
:is(.dialog, .room-view > .container, .chatbox-view-contents) input:not([type=range]),
:is(.dialog, .room-view > .container, .settings-view) select,
.settings-view .section select option {
  background-color: #050505 !important;
  border-color: #4a4a4a !important;
  color: #fff !important;
  caret-color: #fff;
  accent-color: #fff;
}
:is(.dialog, .room-view > .container, .chatbox-view-contents) input:focus:not([type=range]),
:is(.dialog, .room-view > .container, .settings-view) select:focus {
  border-color: #fff !important;
}
:is(.dialog, .room-view, .game-view > .buttons, .chatbox-view-contents > .input,
    .disconnected-view, .replay-controls-view) button:not([data-hook=start-btn]):not([data-hook=stop-btn]),
.dialog .file-btn label, .room-view > .container .file-btn label {
  background-color: #292929 !important;
}
:is(.dialog, .room-view, .game-view > .buttons, .chatbox-view-contents > .input,
    .disconnected-view, .replay-controls-view) button:not([data-hook=start-btn]):not([data-hook=stop-btn]):hover:not(:disabled),
.dialog .file-btn label:hover, .room-view > .container .file-btn label:hover {
  background-color: #404040 !important;
}
:is(.dialog, .room-view, .game-view > .buttons, .chatbox-view-contents > .input,
    .disconnected-view, .replay-controls-view) button:not([data-hook=start-btn]):not([data-hook=stop-btn]):active:not(:disabled),
.dialog .file-btn label:active, .room-view > .container .file-btn label:active {
  background-color: #181818 !important;
}
:is(.dialog, .room-view, .game-view > .buttons, .chatbox-view-contents > .input,
    .disconnected-view, .replay-controls-view) button:not([data-hook=start-btn]):not([data-hook=stop-btn]):disabled {
  background-color: #222 !important;
}
.room-view > .container > .teams .player-list-view .list {
  background-color: #050505 !important;
}
.room-view .player-list-item:hover,
.roomlist-view .filters .bool:hover,
.roomlist-view > .dialog > .splitter > .list tbody tr:hover,
.pick-stadium-view .list > .elem:hover, .change-location-view .list > .elem:hover,
.settings-view .section .toggle:hover,
.settings-view .section .inputrow > :not(:first-child):hover {
  background-color: #292929 !important;
}
.roomlist-view .filters .bool,
.settings-view .section .inputrow > :not(:first-child) {
  background-color: #242424 !important;
}
.roomlist-view > .dialog > .splitter > .list tbody tr.selected,
.pick-stadium-view .list > .elem.selected, .change-location-view .list > .elem.selected,
.settings-view .tabs button.selected {
  background-color: #484848 !important;
}
.roomlist-view > .dialog > .splitter > .list table.header,
.settings-view .section .inputrow:nth-child(odd) {
  background-color: #171717 !important;
}
.chatbox-view-contents,
.game-view.chat-bg-full .bottom-section {
  background-color: rgba(12, 12, 12, var(--chat-opacity, 1)) !important;
}
.game-view.chat-bg-full .bottom-section .chatbox-view-contents,
.game-view.chat-bg-full .bottom-section .stats-view,
.game-state-view.restricted .bar {
  background-color: transparent !important;
}
.stats-view {
  background-color: rgba(0, 0, 0, .3) !important;
}
.game-view > [data-hook=popups] {
  background-color: rgba(0, 0, 0, .5) !important;
}
.chatbox-view-contents > .autocompletebox {
  background-color: #111 !important;
  border-color: #666 !important;
  color: #fff !important;
}
.chatbox-view-contents > .autocompletebox > div:hover,
.chatbox-view-contents > .autocompletebox > div.selected {
  background-color: #404040 !important;
}
.ps__thumb-x, .ps__thumb-y,
.roomlist-view .simplebar-scrollbar {
  background-color: #666 !important;
}
.ps__thumb-x:hover, .ps__thumb-y:hover {
  background-color: #999 !important;
}
.slider::-webkit-slider-thumb {
  background-color: #fff !important;
}
.slider::-moz-range-thumb {
  background-color: #fff !important;
}
`;

const THEME_STYLE_ID = 'ovj-monochrome-game-theme';

/** Ordinary main-world code: adds one style node, with no APIs or listeners. */
function frameThemeSource() {
  function installTheme(css, styleId) {
    if (location.protocol !== 'https:' || location.port || location.username || location.password ||
        !['www.haxball.com', 'haxball.com', 'html5.haxball.com'].includes(location.hostname)) return false;
    const root = document.head || document.documentElement;
    if (!root) return false;
    let style = document.getElementById(styleId);
    if (style && style.tagName !== 'STYLE') return false;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      root.appendChild(style);
    } else if (style.textContent !== css) {
      style.textContent = css;
    }
    return true;
  }
  return `(${installTheme.toString()})(${JSON.stringify(GAME_THEME_CSS)}, ${JSON.stringify(THEME_STYLE_ID)})`;
}

module.exports = { GAME_THEME_CSS, THEME_STYLE_ID, frameThemeSource };
