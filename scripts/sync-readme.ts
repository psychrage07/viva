import {readFileSync,writeFileSync} from 'node:fs';
const readme=readFileSync('README.md','utf8');
const benchmark=readFileSync('BENCHMARK.md','utf8').replace(/^# Viva — measured benchmarks\n\n/,'');
const begin='<!-- BENCHMARK_TABLES -->';const end='<!-- /BENCHMARK_TABLES -->';
const start=readme.indexOf(begin);if(start<0)throw new Error('Missing benchmark marker');
const oldEnd=readme.indexOf(end,start);const rest=oldEnd>=0?readme.slice(oldEnd+end.length):readme.slice(start+begin.length);
writeFileSync('README.md',readme.slice(0,start)+begin+'\n\n'+benchmark+'\n'+end+rest);
console.log('README contains measured engine and coverage tables with provenance.');
