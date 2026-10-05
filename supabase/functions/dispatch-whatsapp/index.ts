import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH_API_VERSION = 'v23.0'
const WABA_ID = '1308239590982353'
const REQUIRED_TEMPLATES = ['order_status_update', 'repeat_order_reminder'] as const

type NotificationJob = {
  id: string
  recipient: string
  template_name: string
  payload: Record<string, unknown>
  attempts: number
  scheduled_for: string
  status: 'pending' | 'failed'
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

function normalizePhoneNumber(value: string) {
  return value.replace(/\D/g, '')
}

async function metaRequest(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  return fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function checkMetaConnection(
  token: string,
  phoneNumberId: string,
) {
  const [phoneResponse, templateResponse] = await Promise.all([
    metaRequest(
      token,
      `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    ),
    metaRequest(
      token,
      `/${WABA_ID}/message_templates?fields=name,status,language&limit=100`,
    ),
  ])

  const phoneBody = await phoneResponse.text()
  if (!phoneResponse.ok) {
    throw new Error(`Meta phone check ${phoneResponse.status}: ${phoneBody.slice(0, 500)}`)
  }

  const templateBody = await templateResponse.text()
  if (!templateResponse.ok) {
    throw new Error(`Meta template check ${templateResponse.status}: ${templateBody.slice(0, 500)}`)
  }

  const phone = JSON.parse(phoneBody)
  const templateData = JSON.parse(templateBody)?.data ?? []
  const templates = REQUIRED_TEMPLATES.map((name) => {
    const match = templateData.find(
      (template: { name?: string }) => template.name === name,
    )
    return {
      name,
      present: Boolean(match),
      status: match?.status ?? null,
      language: match?.language ?? null,
    }
  })

  return {
    connected: true,
    provider: 'meta_cloud_api',
    phone: {
      displayPhoneNumber: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null,
      qualityRating: phone.quality_rating ?? null,
    },
    templates,
    ready: templates.every(({ present, status }) =>
      present && status === 'APPROVED'
    ),
  }
}

function metaTemplateComponents(payload: Record<string, unknown>) {
  return [{
    type: 'body',
    parameters: Object.values(payload).map((value) => ({
      type: 'text',
      text: String(value ?? ''),
    })),
  }]
}

Deno.serve(async (request) => {
  if (request.headers.get('authorization') !== `Bearer ${Deno.env.get('AUTOMATION_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let metaToken: string
  let metaPhoneNumberId: string
  try {
    metaToken = requiredEnv('META_WHATSAPP_ACCESS_TOKEN')
    metaPhoneNumberId = requiredEnv('META_WHATSAPP_PHONE_NUMBER_ID')
  } catch (configurationError) {
    return Response.json({ error: String(configurationError) }, { status: 503 })
  }

  const url = new URL(request.url)
  if (url.searchParams.get('mode') === 'health') {
    try {
      return Response.json(await checkMetaConnection(metaToken, metaPhoneNumberId))
    } catch (healthError) {
      return Response.json({
        connected: false,
        provider: 'meta_cloud_api',
        error: String(healthError),
      }, { status: 502 })
    }
  }

  const templateHealth = await checkMetaConnection(metaToken, metaPhoneNumberId)
  if (!templateHealth.ready) {
    return Response.json({
      error: 'Required Meta WhatsApp templates are missing or not approved',
      templates: templateHealth.templates,
    }, { status: 503 })
  }

  const { error: automationError } = await supabase.rpc('process_order_automation')
  if (automationError) {
    return Response.json({ error: automationError.message }, { status: 500 })
  }

  const { data: jobs, error } = await supabase
    .from('notification_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 3)
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at')
    .limit(25)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  let sent = 0
  for (const job of (jobs ?? []) as NotificationJob[]) {
    const { data: claimedJob, error: claimError } = await supabase
      .from('notification_outbox')
      .update({
        status: 'processing',
        attempts: job.attempts + 1,
      })
      .eq('id', job.id)
      .eq('status', job.status)
      .select('id')
      .maybeSingle()

    if (claimError || !claimedJob) continue

    try {
      const recipient = normalizePhoneNumber(job.recipient)
      if (!recipient) throw new Error('Notification recipient is not a valid phone number')

      const response = await metaRequest(
        metaToken,
        `/${metaPhoneNumberId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: 'template',
            template: {
              name: job.template_name,
              language: { code: 'en' },
              components: metaTemplateComponents(job.payload ?? {}),
            },
          }),
        },
      )
      const responseBody = await response.text()
      if (!response.ok) {
        throw new Error(`Meta ${response.status}: ${responseBody.slice(0, 500)}`)
      }

      await supabase.from('notification_outbox').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', job.id)
      sent += 1
    } catch (sendError) {
      const retryable = job.attempts + 1 < 3
      await supabase.from('notification_outbox').update({
        status: 'failed',
        scheduled_for: retryable
          ? new Date(Date.now() + (job.attempts + 1) * 15 * 60 * 1000).toISOString()
          : job.scheduled_for,
        last_error: String(sendError),
      }).eq('id', job.id)
    }
  }

  return Response.json({
    provider: 'meta_cloud_api',
    processed: jobs?.length ?? 0,
    sent,
  })
})
