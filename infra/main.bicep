// HERMES Helfer: Azure environment for the pilot (Increment 2).
// Deployment steps: docs/deployment.md. Everything stays in one EU region.

targetScope = 'resourceGroup'

import { modelDeployment } from 'modules/ai.bicep'

@description('Short name of the environment, for example pilot. Part of all resource names.')
@minLength(2)
@maxLength(12)
param environmentName string

@description('Azure region, an EU region (architecture §4.3). Default: the resource group region.')
param location string = resourceGroup().location

param tags object = {
  application: 'hermes-helfer'
  environment: environmentName
}

@description('Address space of the virtual network.')
param vnetAddressPrefix string = '10.40.0.0/16'

@description('Container image. Empty on the first deployment, before the image is in the registry.')
param image string = ''

@description('Allowed client IP ranges (CIDR), for example the company egress addresses; empty allows all.')
param allowedIpRanges array = []

@description('From entra.bicep (or existing app registrations); needed once image is set.')
param entraApiClientId string = ''
param entraWebClientId string = ''
param entraApiScope string = ''

@description('Entra ID admin of the SQL server, for example a DBA group (sid: object ID; for applications the client ID). Empty: the migration job identity.')
param sqlAdmin {
  login: string
  sid: string
  principalType: 'Application' | 'Group' | 'User'
}?

param sqlMaxVCores int = 2
param sqlAutoPauseDelay int = -1
param enableDefenderForSql bool = true
param uploadLedgerDigests bool = true

@description('CanNotDelete locks on the database server and the digest storage.')
param lockDataResources bool = true

@description('Days the ledger digests are kept unchangeable (architecture §9.6: project lifetime plus 10 years).')
param ledgerDigestRetentionDays int = 3650

@description('Interactive retention of logs in Log Analytics.')
param logRetentionDays int = 90

@description('Model for drafts and the Kritiker (decision F2 to F4).')
param draftModel modelDeployment

@description('Model for the Delivery-Assistent; may be the same deployment as draftModel.')
param chatModel modelDeployment

@description('Shown to users as the place of processing, for example "Sweden Central (regional)".')
param aiRegionLabel string

var name = 'hh-${environmentName}'

module identities 'modules/identities.bicep' = {
  name: 'identities'
  params: { name: name, location: location, tags: tags }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    name: name
    location: location
    tags: tags
    retentionInDays: logRetentionDays
    publisherPrincipalIds: [identities.outputs.apiPrincipalId, identities.outputs.migratePrincipalId]
  }
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: { name: name, location: location, tags: tags, addressPrefix: vnetAddressPrefix }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    name: name
    location: location
    tags: tags
    pullPrincipalIds: [identities.outputs.apiPrincipalId, identities.outputs.migratePrincipalId]
  }
}

// The SQL server name is fixed before the server exists, so storage can trust it.
var sqlServerName = 'sql-${name}-${uniqueString(resourceGroup().id)}'

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: name
    location: location
    tags: tags
    sqlServerId: resourceId('Microsoft.Sql/servers', sqlServerName)
    retentionDays: ledgerDigestRetentionDays
    endpointsSubnetId: network.outputs.endpointsSubnetId
    blobZoneId: network.outputs.blobZoneId
    lock: lockDataResources
  }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    name: name
    serverName: sqlServerName
    location: location
    tags: tags
    // For a managed identity, Azure SQL identifies the admin by its client ID.
    admin: sqlAdmin ?? {
      login: identities.outputs.migrateName
      sid: identities.outputs.migrateClientId
      principalType: 'Application'
    }
    maxVCores: sqlMaxVCores
    autoPauseDelay: sqlAutoPauseDelay
    workspaceId: monitoring.outputs.workspaceId
    endpointsSubnetId: network.outputs.endpointsSubnetId
    sqlZoneId: network.outputs.sqlZoneId
    digestStorageId: storage.outputs.id
    digestBlobEndpoint: storage.outputs.blobEndpoint
    uploadLedgerDigests: uploadLedgerDigests
    enableDefender: enableDefenderForSql
    lock: lockDataResources
  }
}

module ai 'modules/ai.bicep' = {
  name: 'ai'
  params: {
    name: name
    location: location
    tags: tags
    draftModel: draftModel
    chatModel: chatModel
    userPrincipalIds: [identities.outputs.apiPrincipalId]
    workspaceId: monitoring.outputs.workspaceId
    endpointsSubnetId: network.outputs.endpointsSubnetId
    aiZoneIds: network.outputs.aiZoneIds
  }
}

module apps 'modules/container-apps.bicep' = {
  name: 'container-apps'
  params: {
    name: name
    location: location
    tags: tags
    appsSubnetId: network.outputs.appsSubnetId
    appsPrefix: network.outputs.appsPrefix
    workspaceId: monitoring.outputs.workspaceId
    image: image
    registryServer: registry.outputs.loginServer
    allowedIpRanges: allowedIpRanges
    api: {
      identityId: identities.outputs.apiId
      clientId: identities.outputs.apiClientId
      name: identities.outputs.apiName
    }
    migrate: {
      identityId: identities.outputs.migrateId
      clientId: identities.outputs.migrateClientId
    }
    entra: {
      apiClientId: entraApiClientId
      webClientId: entraWebClientId
      apiScope: entraApiScope
    }
    sql: {
      server: sql.outputs.serverFqdn
      database: sql.outputs.databaseName
    }
    ai: {
      endpoint: ai.outputs.endpoint
      draftDeployment: ai.outputs.draftDeployment
      chatDeployment: ai.outputs.chatDeployment
      regionLabel: aiRegionLabel
    }
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

output appUrl string = apps.outputs.appUrl
output registryName string = registry.outputs.name
output registryLoginServer string = registry.outputs.loginServer
output migrationJobName string = apps.outputs.migrationJobName
output sqlServerName string = sql.outputs.serverName
output digestStorageName string = storage.outputs.name
