import { describe, expect, it } from 'vitest'
import { contentDisposition } from './storage'


describe('Content-Disposition', () => {
  /**
   * Der Fall, an dem die aufgetrennten PDFs unsichtbar wurden: Ihre Namen
   * enthalten einen Gedankenstrich, und der liegt außerhalb von Latin-1.
   * Node bricht dann beim Setzen der Kopfzeile ab – die Antwort scheitert
   * komplett, im Browser fehlt die Datei einfach.
   */
  function istLatin1Tauglich(wert: string): boolean {
    return [...wert].every((z) => z.charCodeAt(0) <= 0xff)
  }

  it('macht aus einem Gedankenstrich einen Header, den Node annimmt', () => {
    const wert = contentDisposition(true, 'Bewerbung \u2013 Anschreiben 1.pdf')

    expect(istLatin1Tauglich(wert)).toBe(true)
    expect(wert).toContain('inline')
    expect(wert).toContain('filename="Bewerbung - Anschreiben 1.pdf"')
    // Der echte Name bleibt für heutige Browser erhalten.
    expect(wert).toContain("filename*=UTF-8''")
    expect(wert).toContain('%E2%80%93')
  })

  it('schreibt Umlaute im ASCII-Teil aus', () => {
    const wert = contentDisposition(false, 'Lebenslauf Müller Größe.pdf')

    expect(istLatin1Tauglich(wert)).toBe(true)
    expect(wert).toContain('filename="Lebenslauf Mueller Groesse.pdf"')
    expect(wert).toContain('attachment')
  })

  it('kommt auch mit fernen Schriften klar', () => {
    const wert = contentDisposition(true, 'Bewerbung 履歴書.pdf')

    expect(istLatin1Tauglich(wert)).toBe(true)
    expect(wert).toContain("filename*=UTF-8''")
  })

  it('lässt einen harmlosen Namen unverändert', () => {
    const wert = contentDisposition(true, 'Bewerbung.pdf')

    expect(wert).toContain('filename="Bewerbung.pdf"')
  })

  it('fällt bei einem Namen ganz ohne brauchbare Zeichen auf einen Ersatz zurück', () => {
    const wert = contentDisposition(false, '???.pdf'.replace(/\?/g, '\u2026'))

    expect(istLatin1Tauglich(wert)).toBe(true)
    expect(wert).toMatch(/filename="[^"]+"/)
  })
})
