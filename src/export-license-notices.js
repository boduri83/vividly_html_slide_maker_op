// SPDX-License-Identifier: MPL-2.0
/** Export software notices; presentation content retains its own license terms. */
export const VIVIDLY_EXPORT_MPL_NOTICE = "Copyright (c) 2026 boduri83\n\nThis Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.\n";
export const LUCIDE_ICON_LICENSE = "ISC License\n\nCopyright (c) 2026 Lucide Icons and Contributors\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n\n---\n\nThe following Lucide icons are derived from the Feather project:\n\nairplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out\n\nThe MIT License (MIT) (for the icons listed above)\n\nCopyright (c) 2013-present Cole Bemis\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";

// Editable SVG data currently carries no reliable library provenance marker.
// Retain the pinned icon notice conservatively whenever SVG data is exported.
function containsSvg(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'svg' && value.svg) return true;
  return Object.values(value).some(containsSvg);
}

function commentLicense(text) {
  // The source's Markdown separator is not license wording and cannot appear
  // literally inside an HTML comment. Keep every other original character.
  const body = text.replace(/^---(?=\r?$)/gm, '');
  if (body.includes('--')) throw new Error('A bundled license contains invalid HTML comment text.');
  return body;
}

export function exportLicenseNotices(document) {
  const notices = [
    'Vividly bundled software license notices',
    'These notices cover bundled export software and, when present, icon geometry.',
    'They do not assign a license to the presentation author content.',
    '',
    commentLicense(VIVIDLY_EXPORT_MPL_NOTICE),
    'The preferred modification source, MPL license text and extraction/build instructions are embedded in the non-executing data block #vividly-runtime-source (JSON script or template).',
    'Use scripts/extract-export-source.mjs from the matching Vividly distribution or follow the embedded archive readme to restore files[].path/content.',
  ];
  if (containsSvg(document)) notices.push('Lucide icon geometry source notices (retained for editable SVG content):', commentLicense(LUCIDE_ICON_LICENSE));
  return '<!--\n' + notices.join('\n') + '\n-->';
}
