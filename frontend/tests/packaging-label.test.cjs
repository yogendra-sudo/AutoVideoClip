const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript')
const file=path.resolve(__dirname,'../src/features/studio/packagingLabel.ts'),m=new Module(file,module)
m.require=name=>name==='../../i18n'?{t:value=>value}:require(name)
m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file)
const pack={template:'interview_zh',audience_language:'zh',source_language:'en',burned_captions:false,fallback:true,cues:[]}
test('missing or original-only captions never advertise bilingual captions',()=>{
 assert.equal(m.exports.packagingLabel(pack),'Interview style')
 assert.equal(m.exports.packagingLabel({...pack,cues:[{text:'Original source',original:''}]}),'Interview style')
 assert.equal(m.exports.packagingLabel({...pack,cues:[{text:'Untranslated source',original:'Original source'}]}),'Interview style')
 assert.equal(m.exports.packagingLabel({...pack,cues:[{text:'翻译',original:'Original source'}]}),'Interview style · Chinese and English captions')
 assert.equal(m.exports.packagingLabel({...pack,source_language:'other',cues:[{text:'Translation',original:'Japanese'}]}),'Interview style')
})
test('fallback hint distinguishes usable captions from an empty old package',()=>{
 assert.equal(m.exports.packagingFallbackHint(pack),'Packaging is incomplete; captions are currently unavailable')
 assert.equal(m.exports.packagingFallbackHint({...pack,cues:[{text:'Subtitles',original:''}]}),'Packaging is incomplete; available captions have been kept')
 assert.equal(m.exports.packagingFallbackHint({...pack,fallback:false}),'')
})

test('caption-free visual highlights do not claim missing requested subtitles',()=>{
 assert.equal(m.exports.packagingFallbackHint({...pack,source_language:'other'},[],false),'')
 assert.equal(m.exports.packagingFallbackHint(pack,[],true),'Packaging is incomplete; captions are currently unavailable')
})
test('R11: captions switched off never claims captions were kept, even when recovered or burned',()=>{
 assert.equal(m.exports.packagingFallbackHint(pack,['Packaging was incomplete, so the original captions are used'],false),'')
 assert.equal(m.exports.packagingFallbackHint({...pack,burned_captions:true},[],false),'')
 assert.equal(m.exports.packagingFallbackHint({...pack,cues:[{text:'Subtitles',original:''}]},[],false),'')
})
test('bilingual label respects captions_enabled (r12 #23): same packaging on/off',()=>{
 const p={...pack,cues:[{text:'翻译',original:'Original source'}]}
 assert.equal(m.exports.packagingLabel({...p,captions_enabled:true}),'Interview style · Chinese and English captions')
 assert.equal(m.exports.packagingLabel({...p,captions_enabled:false}),'Interview style')
})
