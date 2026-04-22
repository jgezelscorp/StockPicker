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

@description('Alpha Vantage MCP API key')
@secure()
param alphaVantageApiKey string

@description('Azure OpenAI API key')
@secure()
param azureOpenaiApiKey string

@description('Azure OpenAI endpoint URL')
@secure()
param azureOpenaiEndpoint string

@description('Azure OpenAI deployment name')
param azureOpenaiDeployment string

@description('Azure OpenAI API version')
param azureOpenaiApiVersion string

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
    acrName: acr.outputs.acrName
    imageTag: imageTag
    finnhubApiKey: finnhubApiKey
    alphaVantageApiKey: alphaVantageApiKey
    azureOpenaiApiKey: azureOpenaiApiKey
    azureOpenaiEndpoint: azureOpenaiEndpoint
    azureOpenaiDeployment: azureOpenaiDeployment
    azureOpenaiApiVersion: azureOpenaiApiVersion
  }
}

module containerAppClient 'modules/container-app-client.bicep' = {
  name: 'container-app-client'
  params: {
    location: location
    environmentId: containerAppsEnv.outputs.environmentId
    acrLoginServer: acr.outputs.acrLoginServer
    acrName: acr.outputs.acrName
    imageTag: imageTag
    apiUrl: 'https://${containerAppApi.outputs.fqdn}'
  }
}

output acrLoginServer string = acr.outputs.acrLoginServer
output apiUrl string = containerAppApi.outputs.fqdn
output clientUrl string = containerAppClient.outputs.fqdn
