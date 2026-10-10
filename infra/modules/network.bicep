// Virtual network: one subnet for the Container Apps environment, one for the
// private endpoints of SQL, storage and the AI service, and the private DNS
// zones that resolve those endpoints inside the network.

param name string
param location string
param tags object

@description('Address space, for example 10.40.0.0/16. Must not overlap with networks you peer later.')
param addressPrefix string

var appsPrefix = cidrSubnet(addressPrefix, 23, 0)
var endpointsPrefix = cidrSubnet(addressPrefix, 24, 2)

var dnsZones = [
  'privatelink${environment().suffixes.sqlServerHostname}'
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.cognitiveservices.azure.com'
  'privatelink.openai.azure.com'
  'privatelink.services.ai.azure.com'
]

resource endpointsNsg 'Microsoft.Network/networkSecurityGroups@2025-05-01' = {
  name: 'nsg-${name}-endpoints'
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: 'vnet-${name}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [addressPrefix] }
    subnets: [
      {
        name: 'snet-apps'
        properties: {
          addressPrefix: appsPrefix
          delegations: [
            {
              name: 'container-apps'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        name: 'snet-endpoints'
        properties: {
          addressPrefix: endpointsPrefix
          networkSecurityGroup: { id: endpointsNsg.id }
          privateEndpointNetworkPolicies: 'Enabled'
        }
      }
    ]
  }
}

resource zones 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for zone in dnsZones: {
    name: zone
    location: 'global'
    tags: tags
  }
]

resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (zone, i) in dnsZones: {
    parent: zones[i]
    name: 'link-${name}'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
  }
]

output appsSubnetId string = vnet.properties.subnets[0].id
output appsPrefix string = appsPrefix
output endpointsSubnetId string = vnet.properties.subnets[1].id
output sqlZoneId string = zones[0].id
output blobZoneId string = zones[1].id
output aiZoneIds array = [zones[2].id, zones[3].id, zones[4].id]
