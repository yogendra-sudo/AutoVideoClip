const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const { runInSandbox } = require('./vm-sandbox.cjs')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{createInstance}=require('i18next')
const { loadTs } = require('./load-ts.cjs')
const langs=['zh','en','ja','ko','es','pt','ru','fr']
const catalogs=Object.fromEntries(langs.map(l=>[l,require('../src/i18n/locales/'+l+'.json')]))
const { USER_MESSAGES } = loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts'))
const root=path.resolve(__dirname,'../src/features/studio')
function history(i18n){
 const exports={}
 const mocks={
  'react/jsx-runtime':require('react/jsx-runtime'),
  'react-i18next':{useTranslation:()=>({t:s=>i18n.t(s)})},
  '../../i18n':{t:s=>i18n.t(s),getLocale:()=>i18n.language},
  '../../ui':{Dialog:p=>React.createElement('section',null,p.children),ProgressLine:()=>null},
  'react-router-dom':{Link:p=>React.createElement('a',null,p.children)},
  './StudioDownloadLink':{default:()=>null},
 }
 runInSandbox(ts.transpileModule(fs.readFileSync(path.join(root,'ExportHistory.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:id=>{assert.ok(mocks[id],id);return mocks[id]}})
 return exports.default
}
test('export history keeps English source titles, coded errors, and unknown diagnostics in every locale',async()=>{
 const i=createInstance();await i.init({resources:Object.fromEntries(langs.map(l=>[l,{translation:catalogs[l]}])),lng:'en',fallbackLng:'en',keySeparator:false,nsSeparator:false,interpolation:{escapeValue:false}})
 const History=history(i),title='The source has no audio track. This export is silent.',unknown='decoder failed at frame 42'
 const base={title,revision:2,created_at:'2026-09-25T00:00:00Z'}
 const restart=USER_MESSAGES.service_restarted
 const jobs=[{...base,job_id:'ok',status:'completed',result:{warnings:[title]}},{...base,job_id:'restart',status:'failed',error:restart},{...base,job_id:'unknown',status:'failed',error:unknown}]
 for(const lang of langs){
  await i.changeLanguage(lang)
  const html=renderToStaticMarkup(React.createElement(History,{open:true,onClose(){},projectId:'p',jobs}))
  assert.ok(html.includes('<b>'+title+'</b>'),lang+' source title preserved')
  assert.ok(html.includes(title),lang+' warning')
  assert.ok(html.includes(restart),lang+' restart')
  assert.ok(html.includes(unknown),lang+' diagnostics preserved')
 }
})
test('studio processing stages remain English in every locale catalog',()=>{
 const stages=["Could not start the import. Please retry; your source and existing exports are preserved.","Production could not start. Please confirm again; your source and existing exports have been preserved.",'The export could not start. Please retry; existing exports have been preserved.','Downloading media','Analyzing visuals','Preparing media','Checking suitable output types','Starting selected outputs','Creating content clips','Creating highlights','Creating promotional drafts','Scanning visuals for highlight candidates','Reviewing the selected highlight boundaries','Preparing promotional openings and drafts','Preparing highlight drafts']
 for(const lang of langs)for(const stage of stages)assert.equal(catalogs[lang][stage],stage,`${lang}: ${stage}`)
})
test('source-blocked recovery uses stable English copy',()=>{
 assert.match(USER_MESSAGES.source_blocked,/private|restricted|sign-in/)
 const codes = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts'))
 assert.equal(codes.ERROR_CODE.test('source_blocked'), true)
})
test('source_too_short / source_no_audio use stable English copy',()=>{
 assert.match(USER_MESSAGES.source_too_short,/too short|longer video/i)
 assert.match(USER_MESSAGES.source_no_audio,/no audio track/i)
 const codes = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts'))
 assert.equal(codes.ERROR_CODE.test('source_too_short') && codes.ERROR_CODE.test('source_no_audio'), true)
})
test('restart recovery uses stable English copy and preserves its error code',()=>{
 const restart=USER_MESSAGES.service_restarted
 assert.match(restart,/app restarted/i)
 const codes = require('./load-ts.cjs').loadTs(path.resolve(__dirname, '../src/analytics/failureCodes.ts'))
 assert.equal(codes.ERROR_CODE.test('service_restarted'), true)
})
test('Studio progress messages stay English in every locale catalog',()=>{
 const keys=['Rendering ready-to-post videos','Retrying the video version','Merging audio and video']
 for(const lang of langs)for(const key of keys)assert.equal(catalogs[lang][key],key,`${lang}: ${key}`)
})
test('model-call failures use fixed English copy for stable codes',()=>{
 const messages=['llm_auth_invalid','connection','timeout','rate_limited'].map(code=>USER_MESSAGES[code])
 assert.equal(messages.length,4)
 assert.equal(USER_MESSAGES.llm_auth_invalid,USER_MESSAGES.invalid_key)
 for(const message of messages)assert.ok(message && !/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(message))
})