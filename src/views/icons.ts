// Tute's icons, drawn for tute on a 24×24 grid: round, soft shapes that sit
// well next to the jelly. Filled unless the caller asks for a stroke (`check`
// and `chevronRight` are drawn as lines).

export const ICONS = {
  // A rounded little house with a door.
  house:
    "M12 3.4c.5 0 1 .2 1.4.5l6.7 5.7c.6.5.9 1.2.9 2V19a2 2 0 0 1-2 2h-3.6v-5.4a1.6 1.6 0 0 0-1.6-1.6h-3.6a1.6 1.6 0 0 0-1.6 1.6V21H5a2 2 0 0 1-2-2v-7.4c0-.8.3-1.5.9-2l6.7-5.7c.4-.3.9-.5 1.4-.5z",
  // A speech bubble with the pinched corner of tute's buttons.
  bubble: "M6 3.8h12a3.2 3.2 0 0 1 3.2 3.2v7.4a3.2 3.2 0 0 1-3.2 3.2h-6.4l-4.9 3.5c-.5.4-1.2 0-1.2-.6v-2.9H6A3.2 3.2 0 0 1 2.8 14.4V7A3.2 3.2 0 0 1 6 3.8z",
  // A plus with round ends.
  plus: "M10.5 5.6a1.5 1.5 0 0 1 3 0v4.9h4.9a1.5 1.5 0 0 1 0 3h-4.9v4.9a1.5 1.5 0 0 1-3 0v-4.9H5.6a1.5 1.5 0 0 1 0-3h4.9z",
  // Settings: two sliders with hollow knobs…
  gear:
    "M4 6.4h8.1v2H4a1 1 0 0 1 0-2zm13.9 0H20a1 1 0 0 1 0 2h-2.1zM15 4.6a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zm0 1.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" +
    "M4 15.6h2.1v2H4a1 1 0 0 1 0-2zm7.9 0H20a1 1 0 0 1 0 2h-8.1zM9 13.8a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zm0 1.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z",
  // …and with solid knobs while the settings are open.
  gearFill:
    "M4 6.4h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2zM15 4.4a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" +
    "M4 15.6h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2zM9 13.6a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
  // A round speaker with two soft waves.
  speakerOn:
    "M3.6 9.6A1.6 1.6 0 0 1 5.2 8h2.6l4.3-3.6c.6-.5 1.4 0 1.4.7v13.8c0 .7-.8 1.2-1.4.7L7.8 16H5.2a1.6 1.6 0 0 1-1.6-1.6z" +
    "M15.9 8.7a.9.9 0 0 1 1.3 0 4.7 4.7 0 0 1 0 6.6.9.9 0 1 1-1.3-1.3 2.9 2.9 0 0 0 0-4 .9.9 0 0 1 0-1.3z" +
    "M18.4 6.2a.9.9 0 0 1 1.3 0 8.2 8.2 0 0 1 0 11.6.9.9 0 1 1-1.3-1.3 6.4 6.4 0 0 0 0-9 .9.9 0 0 1 0-1.3z",
  // The same speaker, hushed with a small cross.
  speakerOff:
    "M3.6 9.6A1.6 1.6 0 0 1 5.2 8h2.6l4.3-3.6c.6-.5 1.4 0 1.4.7v13.8c0 .7-.8 1.2-1.4.7L7.8 16H5.2a1.6 1.6 0 0 1-1.6-1.6z" +
    "M16 10.7l1.1-1.1 3.8 3.8-1.1 1.1z" +
    "M19.8 9.6l1.1 1.1-3.8 3.8-1.1-1.1z",
  // Send: an arrow with round ends.
  arrowUp:
    "M12 4.8c.3 0 .6.1.8.3l5 5a1.1 1.1 0 0 1-1.6 1.6l-3.1-3.1V18a1.1 1.1 0 0 1-2.2 0V8.6l-3.1 3.1a1.1 1.1 0 0 1-1.6-1.6l5-5c.2-.2.5-.3.8-.3z",
  // Lines (drawn with a stroke by the caller).
  chevronRight: "M9.5 6 15.5 12 9.5 18",
  check: "M5.5 13 9.6 16.8 18.5 7.2",
  // Badge marks: "needs you", "failed".
  bang: "M10.8 5.4a1.2 1.2 0 0 1 2.4 0v8.2a1.2 1.2 0 0 1-2.4 0zM12 16.4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  xmark: "M5.2 6.9l1.7-1.7 11.9 11.9-1.7 1.7zM17.1 5.2l1.7 1.7L6.9 18.8l-1.7-1.7z",
  // Auto-close: a little hourglass.
  timer:
    "M7 3.5h10a1 1 0 0 1 0 2h-.6c0 2.6-1.5 4.6-3.4 6.5 1.9 1.9 3.4 3.9 3.4 6.5h.6a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2h.6c0-2.6 1.5-4.6 3.4-6.5-1.9-1.9-3.4-3.9-3.4-6.5H7a1 1 0 0 1 0-2z",
  // The bond.
  heart:
    "M12 20.3 10.6 19C5.6 14.5 2.6 11.8 2.6 8.4 2.6 5.7 4.7 3.6 7.4 3.6c1.8 0 3.5.9 4.6 2.2 1.1-1.3 2.8-2.2 4.6-2.2 2.7 0 4.8 2.1 4.8 4.8 0 3.4-3 6.1-8 10.6L12 20.3z",
} as const;
