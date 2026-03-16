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