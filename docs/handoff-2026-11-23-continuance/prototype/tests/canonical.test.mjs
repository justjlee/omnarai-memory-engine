import test from 'node:test';import assert from 'node:assert/strict';
import {stableJson,hashRecord,assertHash} from '../canonical.mjs';
test('object order does not alter hash',()=>assert.equal(hashRecord({b:2,a:1}),hashRecord({a:1,b:2})));
test('canonical arrays retain order',()=>assert.notEqual(hashRecord([1,2]),hashRecord([2,1])));
test('tamper is rejected',()=>assert.throws(()=>assertHash({a:2},hashRecord({a:1})),/Integrity/));
test('invalid canonical number rejected',()=>assert.throws(()=>stableJson({n:NaN}),/Unsupported/));
test('cycles rejected',()=>{const o={};o.o=o;assert.throws(()=>stableJson(o),/Cyclic/)});
