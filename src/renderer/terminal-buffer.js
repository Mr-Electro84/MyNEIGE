'use strict';
(function (root) {
  // Reconstituer les lignes logiques : un retour visuel dû à la largeur n'est pas un saut de ligne.
  function snapshot(buffer) {
    const lines = [];
    for (let index = 0; index < buffer.length; ++index) {
      const line = buffer.getLine(index);
      if (!line) continue;
      const nextWrapped = Boolean(buffer.getLine(index + 1)?.isWrapped);
      const text = line.translateToString(!nextWrapped);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.length ? lines.join('\r\n') + '\r\n' : '';
  }
  function searchTerm(text, wholeWord) {
    if (!wholeWord) return text;
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const separators = '~!@#$%^&*()+`-=[]{}|\\;:"\',./<>?'.replace(/[\\\]\[\-^]/g, '\\$&');
    const wordCharacter = '[^\\s' + separators + ']';
    return '(?<!' + wordCharacter + ')' + escaped + '(?!' + wordCharacter + ')';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { snapshot, searchTerm };
  else root.TerminalBuffer = Object.freeze({ snapshot, searchTerm });
})(globalThis);
