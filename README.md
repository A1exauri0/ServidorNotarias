# Servidor local y Panel Administrativo de Auditoría de Notarías

Aplicación local desarrollada en **Electron, Express (Node.js) y MySQL** para recibir y centralizar los registros y archivos PDF de las aplicaciones de captura clientes de C# en la oficina.

## Características
* **API REST local (Express)**: Centraliza la inserción de auditorías en una base de datos MySQL local y administra la recepción física de archivos PDF de forma paralela.
* **Auto-conteo Físico**: Al recibir un PDF, el servidor analiza el documento en disco y actualiza su conteo de páginas de forma exacta en la base de datos MySQL.
* **Panel de Control (Electron)**: Interfaz de usuario moderna con tema oscuro, KPIs clave y visualizaciones gráficas interactivas mediante Chart.js para medir productividad por usuario y notaría.

## Instalación y Arranque
Requiere tener instalado [Node.js](https://nodejs.org/) y [pnpm](https://pnpm.io/).

1. Instalar las dependencias del proyecto:
   ```bash
   pnpm install
   ```
2. Configurar las variables en el archivo `.env` (puerto del servidor Express, credenciales de conexión de MySQL local y el directorio físico para almacenamiento de PDFs).
3. Arrancar la aplicación (iniciará el Express de fondo y el panel visual de Electron):
   ```bash
   pnpm start
   ```