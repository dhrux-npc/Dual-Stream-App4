FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY DualStreamApp.csproj ./
RUN dotnet restore DualStreamApp.csproj
COPY Program.cs README.md ./
COPY wwwroot ./wwwroot
RUN dotnet publish DualStreamApp.csproj --configuration Release --no-restore --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
COPY --from=build /app/publish ./
USER $APP_UID
ENTRYPOINT ["dotnet", "DualStreamApp.dll"]
