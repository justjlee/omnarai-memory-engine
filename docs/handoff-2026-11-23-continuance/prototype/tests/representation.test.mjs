import test from 'node:test';import assert from 'node:assert/strict';
import {makePrimary,readPrimary,makeInterpretation} from '../representation.mjs';
const p=(text,extra={})=>makePrimary({id:'x',text,actor_declared:'anonymous contributor',...extra});
for(const input of [' বাংলা বাংলা ','中文\n عربي','𝛿 + ∞ ≠ ∅','👩🏽‍🔬','a\t\r\n b','e\u0301','é','{ "answer": 42 }']) {
 test(`roundtrip ${JSON.stringify(input)}`,()=>assert.equal(readPrimary(p(input)),input));
}
test('byte-distinct normalization forms remain distinct',()=>assert.notEqual(p('e\u0301').sha256,p('é').sha256));
test('tampered bytes refused',()=>{const a=p('hello');assert.throws(()=>readPrimary({...a,payload_base64:Buffer.from('hello!').toString('base64')}),/integrity/)});
test('malformed surrogates refused at creation',()=>assert.throws(()=>p('\uD800'),/Non-roundtrippable/));
test('untrusted HTML media type refused',()=>assert.throws(()=>p('<script>x</script>',{media_type:'text/html'}),/Invalid expression/));
test('max bytes enforced',()=>assert.throws(()=>p('a'.repeat(65537)),/too large/));
test('invalid JSON label refused',()=>assert.throws(()=>p('{bad}',{media_type:'application/json; charset=utf-8'}),SyntaxError));
test('independent interpretation does not mutate primary',()=>{const a=p('λx.x');const b=makeInterpretation({id:'i',primary:a,interpretation:'identity function',method:'human reading',interpreter_declared:'test'});assert.equal(b.primary_sha256,a.sha256);assert.equal(readPrimary(a),'λx.x')});
test('arbitrary corrupt UTF-8 cannot be decoded',()=>{const a=p('ok');const bytes=Buffer.from([0xc3,0x28]);assert.throws(()=>readPrimary({...a,payload_base64:bytes.toString('base64'),byte_length:bytes.length,sha256:'d'.repeat(64)}),/integrity/)});
