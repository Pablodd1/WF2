'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessReferenceQuality } = require('../api/_lib/reference-quality.cjs');

test('replaces a captured price only when the exact raw reference is visible', () => {
  const result = assessReferenceQuality({
    brand: 'Patek Philippe',
    reference: '20300USD',
    rawLine: 'Patek Philippe 5296g 2016year used full set 20300USD',
  });
  assert.equal(result.proposed_reference, '5296G');
  assert.ok(result.reasons.includes('REFERENCE_IS_PRICE_OR_LISTING_TEXT'));
  assert.ok(result.reasons.includes('REFERENCE_CORRECTION_AVAILABLE'));
});

test('cleans a Cartier Ref- prefix from exact source evidence', () => {
  const result = assessReferenceQuality({
    brand: 'Cartier',
    reference: 'Ref-WSSA0030',
    rawLine: 'Cartier Ref-WSSA0030 full set',
  });
  assert.equal(result.proposed_reference, 'WSSA0030');
});

test('holds accessories and non-watch categories out of watch publication', () => {
  assert.ok(assessReferenceQuality({
    brand: 'Audemars Piguet', reference: '15500', rawLine: 'BRACELET 15500/26331OR',
  }).reasons.includes('ACCESSORY_NOT_WATCH'));
  assert.ok(assessReferenceQuality({
    brand: 'Hermes', reference: 'Hermes', rawLine: 'Hermes Birkin 25 Gold',
  }).reasons.includes('NON_WATCH_OR_WRONG_CATEGORY'));
});

test('never invents a replacement when no exact reference is visible', () => {
  const result = assessReferenceQuality({
    brand: 'F.P. Journe', reference: '186000USDT', rawLine: 'Octa Reserve de Marche 186000USDT',
  });
  assert.equal(result.proposed_reference, null);
  assert.ok(result.reasons.includes('NEEDS_MANUAL_REVIEW'));
});

test('recognizes exact Omega, JLC, IWC, Tudor, and Piaget reference formats', () => {
  const cases = [
    ['Omega', 'HKD111000', 'Omega Snoopy 310.32.42.50.02.001 HKD111000', '310.32.42.50.02.001'],
    ['Jaeger-LeCoultre', '20700USD', 'Jaeger q1322410 20700USD', 'Q1322410'],
    ['IWC', 'only watch', 'IWC IW371702 only watch', 'IW371702'],
    ['Tudor', 'HKD28600', 'Tudor M7939G1AONRU-0001 HKD28600', 'M7939G1AONRU-0001'],
    ['Piaget', '900HKD', 'Piaget G0A49024 900HKD', 'G0A49024'],
  ];
  for (const [brand, reference, rawLine, expected] of cases) {
    assert.equal(assessReferenceQuality({ brand, reference, rawLine }).proposed_reference, expected);
  }
});
