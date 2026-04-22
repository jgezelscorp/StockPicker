@description('Azure region')
param location string

@description('Container Apps Environment ID')
param environmentId string

@description('ACR login server')
param acrLoginServer string

@description('ACR resource name for credential lookup')
param acrName string

@description('Container image tag')
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

resource existingAcr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: acrName
}

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'apex-api'
  location: location
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 3001
        transport: 'http'
      }
      registries: [
        {
          server: acrLoginServer
          username: existingAcr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: existingAcr.listCredentials().passwords[0].value
        }
        {
          name: 'finnhub-api-key'
          value: finnhubApiKey
        }
        {
          name: 'alpha-vantage-api-key'
          value: !empty(alphaVantageApiKey) ? alphaVantageApiKey : 'not-configured'
        }
        {
          name: 'azure-openai-api-key'
          value: azureOpenaiApiKey
        }
        {
          name: 'azure-openai-endpoint'
          value: azureOpenaiEndpoint
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'apex-api'
          image: '${acrLoginServer}/apex-api:${imageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '3001'
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'DB_PATH'
              value: '/data/apex.db'
            }
            {
              name: 'FINNHUB_API_KEY'
              secretRef: 'finnhub-api-key'
            }
            {
              name: 'ALPHA_VANTAGE_MCP_API_KEY'
              secretRef: 'alpha-vantage-api-key'
            }
            {
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'azure-openai-api-key'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              secretRef: 'azure-openai-endpoint'
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT'
              value: azureOpenaiDeployment
            }
            {
              name: 'AZURE_OPENAI_API_VERSION'
              value: azureOpenaiApiVersion
            }
          ]
          volumeMounts: [
            {
              volumeName: 'sqlite-data'
              mountPath: '/data'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                port: 3001
                path: '/api/health'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                port: 3001
                path: '/api/health'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'sqlite-data'
          storageType: 'EmptyDir'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = apiApp.properties.configuration.ingress.fqdn
output name string = apiApp.name
