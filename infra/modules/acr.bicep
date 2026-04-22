@description('Azure region')
param location string

@description('Unique resource token')
param resourceToken string

var acrName = 'acr${resourceToken}'

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
  }
}

resource acrPullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-07-31-preview' = {
  name: 'id-acr-pull-${resourceToken}'
  location: location
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull built-in role

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, acrPullIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: acrPullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output acrIdentityId string = acrPullIdentity.id
output acrIdentityClientId string = acrPullIdentity.properties.clientId
