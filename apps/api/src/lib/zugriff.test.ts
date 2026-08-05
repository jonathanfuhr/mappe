import { describe, expect, it } from 'vitest'
import { istTailscaleAdresse, passtZumAufruf } from './zugriff'

describe('Tailscale-Adressen erkennen', () => {
  it('erkennt Adressen aus 100.64.0.0/10', () => {
    expect(istTailscaleAdresse('100.72.86.100')).toBe(true)
    expect(istTailscaleAdresse('100.64.0.0')).toBe(true)
    expect(istTailscaleAdresse('100.127.255.255')).toBe(true)
  })

  it('lässt die Nachbarn außerhalb des Bereichs aus', () => {
    // Genau an der Grenze – der häufigste Fehler bei Bereichsprüfungen.
    expect(istTailscaleAdresse('100.63.255.255')).toBe(false)
    expect(istTailscaleAdresse('100.128.0.1')).toBe(false)
    expect(istTailscaleAdresse('99.64.0.1')).toBe(false)
    expect(istTailscaleAdresse('101.64.0.1')).toBe(false)
  })

  it('erkennt übliche lokale Adressen nicht als Tailscale', () => {
    expect(istTailscaleAdresse('192.168.112.45')).toBe(false)
    expect(istTailscaleAdresse('172.18.0.3')).toBe(false)
    expect(istTailscaleAdresse('127.0.0.1')).toBe(false)
  })

  it('kommt mit der IPv6-gemappten Schreibweise zurecht', () => {
    // So liefert Express die Adresse, wenn der Server auf :: lauscht.
    expect(istTailscaleAdresse('::ffff:100.72.86.100')).toBe(true)
    expect(istTailscaleAdresse('::ffff:192.168.1.1')).toBe(false)
  })

  it('weist Unsinn ab, statt ihn zu deuten', () => {
    expect(istTailscaleAdresse('')).toBe(false)
    expect(istTailscaleAdresse('100.64.0')).toBe(false)
    expect(istTailscaleAdresse('100.64.0.1.2')).toBe(false)
    expect(istTailscaleAdresse('100.999.0.1')).toBe(false)
    expect(istTailscaleAdresse('hundert.64.0.1')).toBe(false)
    expect(istTailscaleAdresse('::1')).toBe(false)
  })
})

describe('APP_URL gegen den Aufruf prüfen', () => {
  it('erkennt Übereinstimmung', () => {
    expect(passtZumAufruf('https://mappe.example.ts.net', 'mappe.example.ts.net')).toBe(true)
    expect(passtZumAufruf('http://localhost:4300', 'localhost:4300')).toBe(true)
  })

  it('nimmt den Port ernst', () => {
    // Genau der Fall, der auf dem Server monatelang falsch stand.
    expect(passtZumAufruf('http://localhost:3000', 'localhost:4300')).toBe(false)
  })

  it('ignoriert Groß- und Kleinschreibung', () => {
    expect(passtZumAufruf('https://Mappe.Example.ts.net', 'mappe.example.ts.net')).toBe(true)
  })

  it('meldet bei fehlenden oder kaputten Werten kein Passen', () => {
    expect(passtZumAufruf('', 'localhost:4300')).toBe(false)
    expect(passtZumAufruf('http://localhost:4300', '')).toBe(false)
    expect(passtZumAufruf('kein-url', 'localhost:4300')).toBe(false)
  })
})
