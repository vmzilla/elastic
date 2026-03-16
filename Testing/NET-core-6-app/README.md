# .NET Core 6 - Elastic APM Integration Test App

A simple Movie Tracker web application built with ASP.NET Core 6 MVC, used to demonstrate and replicate Elastic APM agent integration issues with minimal NuGet package configuration.

## Purpose

This app was created to replicate a real-world support case where a customer needed to:
- Integrate Elastic APM into a .NET Core application
- Use only the **minimum required NuGet packages** (for audit compliance)
- Avoid unnecessary dependencies like Azure CosmosDB, Azure ServiceBus, Azure Storage, and MongoDB
- Understand why manually deleting DLLs from `Elastic.Apm.NetCoreAll` breaks the application

---

## Tech Stack

- **Framework**: ASP.NET Core 6 MVC
- **APM**: Elastic APM .NET Agent v1.34.1
- **Storage**: In-memory (no database)
- **OS**: Windows Server 2022

---

## The Problem Being Replicated

When using `Elastic.Apm.NetCoreAll`, it installs the following dependencies that may not be needed:

| Package | Required? |
|---------|-----------|
| Elastic.Apm.Azure.CosmosDb | ❌ Not needed |
| Elastic.Apm.Azure.ServiceBus | ❌ Not needed |
| Elastic.Apm.Azure.Storage | ❌ Not needed |
| Elastic.Apm.MongoDb | ❌ Not needed |

When these DLLs are **manually deleted** after publish, the app throws:
```
Unhandled exception. System.IO.FileNotFoundException: 
Could not load file or assembly 'Elastic.Apm.Azure.ServiceBus, 
Version=1.34.0.0'
```

This is because `Elastic.Apm.NetCoreAll` hardcodes references to all its 
dependency DLLs. Deleting them manually causes the app to crash at startup.

---

## The Fix — Minimal Package Approach

Instead of using `Elastic.Apm.NetCoreAll`, install only what you need:
```cmd
dotnet add package Elastic.Apm --version 1.34.1
dotnet add package Elastic.Apm.AspNetCore --version 1.34.1
dotnet add package Elastic.Apm.Extensions.Hosting --version 1.34.1
dotnet add package Elastic.Apm.SqlClient --version 1.34.1
```

### Program.cs Configuration
```
using Elastic.Apm.AspNetCore;
using Elastic.Apm.DiagnosticSource;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllersWithViews();

var app = builder.Build();

// Minimal APM — only HTTP + SQL tracing, no Azure/Mongo
app.UseElasticApm(builder.Configuration,
    new HttpDiagnosticsSubscriber());

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
```

## APM Configuration (appsettings.json)
```json
{
  "ElasticApm": {
    "Enabled": true,
    "ServiceName": "MovieTracker",
    "SecretToken": "your-secret-token",
    "ServerUrl": "https://your-apm-server.elastic-cloud.com",
    "Environment": "UAT",
    "LogLevel": "Debug"
  }
}
```

## References

- [Elastic APM .NET Agent Documentation](https://www.elastic.co/docs/reference/apm/agents/dotnet/setup-asp-net-core)
- [Elastic APM NuGet Packages](https://www.elastic.co/docs/reference/apm/agents/dotnet/nuget-packages)
- [Elastic APM Configuration](https://www.elastic.co/docs/reference/apm/agents/dotnet/configuration)

