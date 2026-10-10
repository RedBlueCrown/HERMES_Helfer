// Container Apps: the environment in the virtual network, the API (which also
// serves the web app) and the migration job. Without an image only the
// environment is created (first deployment, before the image exists).

param name string
param location string
param tags object
param appsSubnetId string

@description('Address range of the apps subnet: the ingress proxies forward client addresses from there.')
param appsPrefix string

param workspaceId string

@description('Container image, for example cr….azurecr.io/hermes-helfer:<git sha>. Empty: environment only.')
param image string
param registryServer string

@description('Allowed client IP ranges (CIDR) for the web app and API; empty allows all (Entra sign-in still required).')
param allowedIpRanges array

param api {
  identityId: string
  clientId: string
  name: string
}
param migrate {
  identityId: string
  clientId: string
}

param entra {
  apiClientId: string
  webClientId: string
  apiScope: string
}

param sql {
  server: string
  database: string
}

param ai {
  endpoint: string
  draftDeployment: string
  chatDeployment: string
  regionLabel: string
  @description('Empty: not set, the model default.')
  reasoningEffort: string
}

param appInsightsConnectionString string

@description('CPU and memory of the API container: 1.0 and 2Gi for the pilot, 0.5 and 1Gi for a test.')
param apiSize {
  cpu: string
  memory: string
}

var deployApp = !empty(image)
var appName = 'ca-${name}-api'

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: appsSubnetId
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    appLogsConfiguration: { destination: 'azure-monitor' }
    peerTrafficConfiguration: { encryption: { enabled: true } }
  }
}

// Console and system logs of the containers to Log Analytics (stream 3 and the ai_run entries of stream 2).
// 2021-05-01-preview is the version with category groups; the linter only offers 2016-09-01.
#disable-next-line use-recent-api-versions
resource environmentLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: environment
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
  }
}

var sqlEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'SQL_SERVER', value: sql.server }
  { name: 'SQL_DATABASE', value: sql.database }
  { name: 'SQL_AUTH', value: 'entra' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
]

resource app 'Microsoft.App/containerApps@2025-01-01' = if (deployApp) {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${api.identityId}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 5
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
        ipSecurityRestrictions: [
          for (range, i) in allowedIpRanges: {
            name: 'allow-${i}'
            ipAddressRange: range
            action: 'Allow'
          }
        ]
      }
      registries: [{ server: registryServer, identity: api.identityId }]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: { cpu: json(apiSize.cpu), memory: apiSize.memory }
          env: filter(
            concat(sqlEnv, [
              { name: 'AZURE_CLIENT_ID', value: api.clientId }
              { name: 'AUTH_MODE', value: 'entra' }
              { name: 'ENTRA_TENANT_ID', value: tenant().tenantId }
              { name: 'ENTRA_API_CLIENT_ID', value: entra.apiClientId }
              { name: 'ENTRA_WEB_CLIENT_ID', value: entra.webClientId }
              { name: 'ENTRA_API_SCOPE', value: entra.apiScope }
              { name: 'STORE', value: 'sql' }
              { name: 'AI_PROVIDER', value: 'azure-openai' }
              { name: 'AZURE_OPENAI_ENDPOINT', value: ai.endpoint }
              { name: 'AZURE_OPENAI_DEPLOYMENT_DRAFT', value: ai.draftDeployment }
              { name: 'AZURE_OPENAI_DEPLOYMENT_CHAT', value: ai.chatDeployment }
              { name: 'AZURE_OPENAI_REGION_LABEL', value: ai.regionLabel }
              { name: 'AZURE_OPENAI_REASONING_EFFORT', value: ai.reasoningEffort }
              { name: 'TRUSTED_PROXIES', value: appsPrefix }
            ]),
            e => !empty(e.value)
          )
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/api/health', port: 8080 }
              periodSeconds: 5
              failureThreshold: 36
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 8080 }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/ready', port: 8080 }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      // One instance: agent runs are recovered at startup and projects are
      // cached in memory (todo-later H02 before scaling out).
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// Started by hand after each deployment that brings migrations:
// az containerapp job start -g <rg> -n caj-<name>-migrate
resource migrationJob 'Microsoft.App/jobs@2025-01-01' = if (deployApp) {
  name: 'caj-${name}-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${migrate.identityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registryServer, identity: migrate.identityId }]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: image
          args: ['dist/migrate.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(sqlEnv, [
            { name: 'AZURE_CLIENT_ID', value: migrate.clientId }
            { name: 'APP_DB_USER', value: api.name }
            { name: 'APP_DB_USER_CLIENT_ID', value: api.clientId }
          ])
        }
      ]
    }
  }
}

output appUrl string = 'https://${appName}.${environment.properties.defaultDomain}'
output migrationJobName string = 'caj-${name}-migrate'
