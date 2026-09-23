const placeholderPatterns = [/^replace-/i,/example\.com/i];

export function validateRuntimeReadiness(env=process.env){
  const errors=[],warnings=[];
  const required=[
    ['DATABASE_URL',env.DATABASE_URL],
    ['OTP_HASH_SECRET',env.OTP_HASH_SECRET]
  ];
  for(const [name,value] of required){
    if(!clean(value)||placeholder(value))errors.push(`${name} is missing or still a placeholder`);
  }
  if(clean(env.OTP_HASH_SECRET).length<32)errors.push('OTP_HASH_SECRET must be at least 32 characters');
  if(env.NODE_ENV==='production'&&!clean(env.SUBIL_ADMIN_ORIGINS))errors.push('SUBIL_ADMIN_ORIGINS is required in production');
  if(clean(env.SUBIL_ADMIN_ORIGINS)&&clean(env.SUBIL_ADMIN_ORIGINS).split(',').some(origin=>!/^https:\/\//i.test(origin.trim())))warnings.push('SUBIL_ADMIN_ORIGINS should use HTTPS origins');

  const otpSenderValues=[env.OTP_SENDER_URL,env.OTP_SENDER_API_KEY].map(clean);
  const configuredOtpSender=otpSenderValues.filter(Boolean).length;
  if(configuredOtpSender===1)warnings.push('OTP sender is partially configured; login OTP delivery will be unavailable until both OTP_SENDER_URL and OTP_SENDER_API_KEY are set');
  if(configuredOtpSender===0)warnings.push('OTP sender is not configured; API health/readiness can run but login OTP delivery is unavailable');
  if(otpSenderValues.some(placeholder))warnings.push('OTP sender settings contain placeholders; login OTP delivery is unavailable');

  const marketingValues=[env.EMAIL_SENDER_URL,env.EMAIL_SENDER_API_KEY,env.WHATSAPP_SENDER_URL,env.WHATSAPP_SENDER_API_KEY].map(clean);
  const emailConfigured=Boolean(marketingValues[0]&&marketingValues[1]),whatsappConfigured=Boolean(marketingValues[2]&&marketingValues[3]);
  if(Boolean(marketingValues[0])!==Boolean(marketingValues[1]))warnings.push('Email marketing sender is partially configured');
  if(Boolean(marketingValues[2])!==Boolean(marketingValues[3]))warnings.push('WhatsApp marketing sender is partially configured');
  if(!emailConfigured)warnings.push('Email marketing delivery is not configured');
  if(!whatsappConfigured)warnings.push('WhatsApp marketing delivery is not configured');
  if(marketingValues.some(placeholder))warnings.push('Marketing sender settings contain placeholders');

  const pushValues=[env.PUSH_PROVIDER_URL,env.PUSH_PROVIDER_API_KEY,env.PUSH_VAPID_PUBLIC_KEY].map(clean);
  const configuredPush=pushValues.filter(Boolean).length;
  if(configuredPush>0&&configuredPush<3)errors.push('Push notifications are partially configured; set PUSH_PROVIDER_URL, PUSH_PROVIDER_API_KEY and PUSH_VAPID_PUBLIC_KEY together');
  if(pushValues.some(placeholder))errors.push('Push notification settings still contain placeholders');

  return{ready:errors.length===0,errors,warnings};
}

export function assertRuntimeReadiness(env=process.env){
  const result=validateRuntimeReadiness(env);
  if(!result.ready){const error=new Error(`Runtime configuration is not ready: ${result.errors.join('; ')}`);error.code='runtime_not_ready';error.details=result;throw error;}
  return result;
}

function clean(value){return String(value||'').trim()}
function placeholder(value){const text=clean(value);return Boolean(text)&&placeholderPatterns.some(pattern=>pattern.test(text))}
