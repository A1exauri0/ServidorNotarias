# Servidor Central y Panel Administrativo de Auditoría de Notarías

Aplicación local desarrollada en **Express (Node.js) y MySQL** encargada de centralizar los registros de auditorías digitales enviados en tiempo real por las terminales clientes.

---

## Topología de Red y Flujo de Archivos

* **Servidor Central (`ServidorNotarias`)**: Corre en la PC principal con la IP **`192.168.1.10`** (puerto `3000`).
* **Unidad de Red Compartida**: Los capturistas y escáneres guardan sus PDFs físicamente de forma directa en un almacenamiento o unidad de red común.
* **Envío de Auditoría**: Cuando un capturista guarda un archivo en la unidad de red, su cliente de digitalización invoca el endpoint **`/api/registrar`** de este servidor. El servidor almacena los metadatos y páginas en la base de datos MySQL de manera inmediata sin realizar copias físicas de archivos, agilizando el flujo de red.
* **Propósito de `RUTA_SSDIREC`**: Esta variable del archivo `.env` define la ruta del servidor local donde se almacenarán físicamente los PDFs únicamente en los flujos de **transferencia masiva o importación forzada** desde la interfaz del panel.

---

## Características

* **API REST Centralizada**: Centraliza la inserción de registros en la base de datos MySQL.
* **Panel de Control**: Interfaz con KPIs clave y gráficos interactivos mediante Chart.js para medir productividad por turno, capturista y notaría.
* **Importación Masiva Integrada**: Vista interactiva de árbol de carpetas con checkboxes para escanear, validar contra la base de datos y transferir PDFs en lotes directamente desde el explorador al servidor.

---

## Instalación y Arranque

1. Instalar dependencias con `pnpm`:
   ```bash
   pnpm install
   ```
2. Configurar las variables en el archivo `.env` (puerto del servidor, credenciales de MySQL y la ruta `RUTA_SSDIREC` para almacenamiento de PDFs en transferencias masivas).
3. Arrancar la aplicación:
   ```bash
   pnpm start
   ```