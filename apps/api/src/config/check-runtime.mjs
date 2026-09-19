import { assertRuntimeReadiness } from './runtime-readiness.mjs';

try {
  const result=assertRuntimeReadiness(process.env);
  if(result.warnings.length)console.warn(JSON.stringify({ready:true,warnings:result.warnings}));
  else console.log(JSON.stringify({ready:true}));
} catch(error) {
  console.error(JSON.stringify({ready:false,errors:error.details?.errors||[error.message],warnings:error.details?.warnings||[]}));
  process.exit(1);
}
