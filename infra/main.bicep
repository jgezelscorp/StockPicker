targetScope = 'resourceGroup'

@description('Environment name prefix for all resources')
param environmentName string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Container image tag (typically git SHA)')
param imageTag string

@description('Finnhub API key')
@secure()
param finnhubApiKey string

@description('OpenAI API key')
@secure()
param openaiApiKey string

var resourceToken = uniqueString(resourceGroup().id, environmentName)

module containerAppsEnv 'modules/container-apps-env.bicep' = {
  name: 'container-apps-env'
  params: {
    environmentName: environmentName
    location: location
    resourceToken: resourceToken
  }
}

module acr 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    location: location
    resourceToken: resourceToken
  }
}

module containerAppApi 'modules/container-app-api.bicep' = {
  name: 'container-app-api'
  params: {
    location: location
    environmentId: containerAppsEnv.outputs.environmentId
    acrLoginServer: acr.outputs.acrLoginServer
    acrIdentityId: acr.outputs.acrIdentityId
    imageTag: imageTag
    finnhubApiKey: finnhubApiKey
    openaiApiKey: openaiApiKey
  }
}

module containerAppClient 'modules/container-app-client.bicep' = {
  name: 'container-app-client'
  params: {
    location: location
    environmentId: containerAppsEnv.outputs.environmentId
    acrLoginServer: acr.outputs.acrLoginServer
    acrIdentityId: acr.outputs.acrIdentityId
    imageTag: imageTag
    apiUrl: 'http://${containerAppApi.outputs.fqdn}/'
  }
}

output acrLoginServer string = acr.outputs.acrLoginServer
output apiUrl string = containerAppApi.outputs.fqdn
output clientUrl string = containerAppClient.outputs.fqdn
output acrIdentityId string = acr.outputs.acrIdentityId
