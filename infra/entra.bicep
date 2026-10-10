// Entra ID app registrations for HERMES Helfer (architecture §6).
// Deployed separately by an identity administrator (role Application
// Administrator), see docs/deployment.md step 3:
//
//   az deployment group create -g <rg> -f infra/entra.bicep \
//     -p environmentName=pilot appUrl=<appUrl output of main.bicep>
//
// Two registrations: the API (scope access_as_user, the four global app
// roles, assignment required) and the web app (single-page app with
// redirect URIs, pre-consented to the API scope).

extension microsoftGraphV1

@description('Short name of the environment, as in main.bicep.')
param environmentName string

@description('Address of the web app (output appUrl of main.bicep).')
param appUrl string

@description('More redirect addresses, for example http://localhost:5173 for developers testing sign-in.')
param extraRedirectUris array = []

@description('Object IDs of the Entra ID groups per app role.')
param roleGroups {
  'HH.User': string[]
  'HH.PMO': string[]
  'HH.Portfolio': string[]
  'HH.Admin': string[]
} = {
  'HH.User': []
  'HH.PMO': []
  'HH.Portfolio': []
  'HH.Admin': []
}

var identifierUri = 'api://hermes-helfer-${environmentName}'
var scopeId = guid(resourceGroup().id, 'hermes-helfer', 'access_as_user')

var roles = [
  {
    value: 'HH.User'
    displayName: 'HERMES Helfer: Nutzung'
    description: 'Darf den HERMES Helfer verwenden. Die Projektrollen vergibt die Projektleitung in der App.'
  }
  {
    value: 'HH.PMO'
    displayName: 'HERMES Helfer: PMO'
    description: 'Sieht alle Vorhaben, legt Vorhaben an und verwaltet Mitglieder.'
  }
  {
    value: 'HH.Portfolio'
    displayName: 'HERMES Helfer: Portfolio-Gremium'
    description: 'Sieht alle Vorhaben und entscheidet Projektfreigabe und Skalierung.'
  }
  {
    value: 'HH.Admin'
    displayName: 'HERMES Helfer: Technische Administration'
    description: 'Technische Administration, ohne Zugriff auf Projektinhalte.'
  }
]

var roleId = toObject(roles, r => r.value, r => guid(resourceGroup().id, 'hermes-helfer', r.value))

var assignments = flatten(map(
  roles,
  r =>
    map(roleGroups[r.value], groupId => {
      role: r.value
      groupId: groupId
    })
))

resource api 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: 'hermes-helfer-api-${environmentName}'
  displayName: 'HERMES Helfer API (${environmentName})'
  signInAudience: 'AzureADMyOrg'
  identifierUris: [identifierUri]
  api: {
    // The API accepts only v2 tokens (issuer …/v2.0, audience = client ID).
    requestedAccessTokenVersion: 2
    oauth2PermissionScopes: [
      {
        id: scopeId
        value: 'access_as_user'
        type: 'User'
        isEnabled: true
        adminConsentDisplayName: 'HERMES Helfer verwenden'
        adminConsentDescription: 'Erlaubt der Web-App, im Namen der angemeldeten Person auf den HERMES Helfer zuzugreifen.'
        userConsentDisplayName: 'HERMES Helfer verwenden'
        userConsentDescription: 'Erlaubt der Web-App, in Ihrem Namen auf den HERMES Helfer zuzugreifen.'
      }
    ]
  }
  appRoles: [
    for r in roles: {
      id: roleId[r.value]
      value: r.value
      displayName: r.displayName
      description: r.description
      allowedMemberTypes: ['User']
      isEnabled: true
    }
  ]
}

// Only people with one of the app roles get a token for the API.
resource apiPrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: api.appId
  appRoleAssignmentRequired: true
}

resource web 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: 'hermes-helfer-web-${environmentName}'
  displayName: 'HERMES Helfer (${environmentName})'
  signInAudience: 'AzureADMyOrg'
  spa: { redirectUris: concat([appUrl], extraRedirectUris) }
  requiredResourceAccess: [
    {
      resourceAppId: api.appId
      resourceAccess: [{ id: scopeId, type: 'Scope' }]
    }
  ]
}

resource webPrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: web.appId
}

// Consent for the whole organization, so people are not asked when they sign in.
resource consent 'Microsoft.Graph/oauth2PermissionGrants@v1.0' = {
  clientId: webPrincipal.id
  consentType: 'AllPrincipals'
  resourceId: apiPrincipal.id
  scope: 'access_as_user'
}

resource groupRoles 'Microsoft.Graph/appRoleAssignedTo@v1.0' = [
  for a in assignments: {
    appRoleId: roleId[a.role]
    principalId: a.groupId
    resourceId: apiPrincipal.id
  }
]

output apiClientId string = api.appId
output webClientId string = web.appId
output apiScope string = '${identifierUri}/access_as_user'
