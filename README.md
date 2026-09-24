# 📊 Gestor de Variables 

> **Sistema integral para la gestión, carga masiva y categorización inteligente de variables e indicadores de gestión pública.**

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-2.x-green.svg)](https://flask.palletsprojects.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E.svg)](https://supabase.com/)
[![Scikit-Learn](https://img.shields.io/badge/Scikit--Learn-ML-F7931E.svg)](https://scikit-learn.org/)
[![Jupyter](https://img.shields.io/badge/Jupyter-Notebook-F37626.svg)](https://jupyter.org/)

---

## 📑 Tabla de Contenidos

1. [Descripción General](#-descripción-general)
2. [Arquitectura y Stack Tecnológico](#-arquitectura-y-stack-tecnológico)
3. [Esquema de Base de Datos (Supabase)](#-esquema-de-base-de-datos-supabase)
4. [Pipeline de Machine Learning](#-pipeline-de-machine-learning)
5. [Estructura del Proyecto](#-estructura-del-proyecto)
6. [Requisitos Previos](#-requisitos-previos)
7. [Configuración e Instalación](#-configuración-e-instalación)
8. [Documentación de la API (Endpoints)](#-documentación-de-la-api-endpoints)
9. [Guía de Uso de la Interfaz](#-guía-de-uso-de-la-interfaz)
10. [Solución de Problemas (Troubleshooting)](#-solución-de-problemas-troubleshooting)
11. [Autor y Licencia](#-autor-y-licencia)

---

## 📖 Descripción General

Esta aplicación web, desarrollada en **Flask**, permite administrar variables e indicadores utilizados en el seguimiento de políticas públicas, con un enfoque específico en ejes de **corrupción, prevención, detección, sanción y fiscalización**.

El sistema resuelve el problema de la carga manual de datos mediante:
- **Carga masiva inteligente:** Procesa archivos CSV y carpetas ZIP estructuradas.
- **Detección de duplicados:** Evita la redundancia en la base de datos antes de insertar.
- **Categorización automática:** Utiliza modelos de Machine Learning para asignar Proceso, Eje y Tema a cada variable.
- **Interfaz SPA (Single Page Application):** Tabla dinámica editable con filtros avanzados, ordenamiento múltiple y exportación.

---

## 🏗️ Arquitectura y Stack Tecnológico

| Capa | Tecnología | Descripción |
|------|------------|-------------|
| **Backend** | Python 3.10+, Flask | API RESTful y lógica de negocio. |
| **Base de Datos** | Supabase (PostgreSQL) | Almacenamiento de variables, indicadores e historial de cargas. |
| **Machine Learning** | Scikit-Learn, Pandas | Pipeline TF-IDF + Naive Bayes para categorización. |
| **Frontend** | HTML5, CSS3, JavaScript (Vanilla) | Interfaz SPA con tabla editable, filtros y ordenamiento. |
| **Túnel** | Ngrok | Exposición segura del servidor local a internet. |
| **Entorno** | Jupyter Notebook / Google Colab | Ejecución secuencial de bloques de código. |

---

## 🗄️ Esquema de Base de Datos (Supabase)

Para que el sistema funcione, debes tener creadas las siguientes tablas en tu proyecto de Supabase:

### Tabla `variables`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `int8` (PK) | Identificador único autoincremental. |
| `nombre_variable` | `text` | Nombre original de la variable. |
| `proceso` | `text` | Categoría asignada (Prevención, Detección, Sanción, Fiscalización). |
| `eje` | `text` | Eje temático asignado por el modelo. |
| `tema` | `text` | Tema específico asignado por el modelo. |
| `fuente` | `text` | Archivo o ZIP de origen. |
| `created_at` | `timestamp` | Fecha de inserción. |

### Tabla `cargas`
| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `int8` (PK) | Identificador único de la carga. |
| `fecha` | `timestamp` | Fecha y hora de la importación. |
| `tipo` | `text` | 'CSV' o 'ZIP'. |
| `archivo` | `text` | Nombre del archivo cargado. |
| `registros_insertados` | `int4` | Cantidad de registros nuevos. |
| `duplicados_detectados` | `int4` | Cantidad de registros ignorados por duplicado. |

---

## 🤖 Pipeline de Machine Learning

El sistema utiliza un enfoque híbrido para la categorización automática:

1. **Vectorización (TF-IDF):** Convierte el nombre de la variable en una matriz de características numéricas, dando peso a las palabras más relevantes y restando importancia a las comunes (stop words).
2. **Clasificador (Naive Bayes):** Modelo probabilístico entrenado con los datos ya etiquetados en la base de datos. Predice la probabilidad de que una variable pertenezca a un Proceso, Eje o Tema.
3. **Sistema de Fallback (Palabras Clave):** Si la confianza del modelo es menor al umbral definido (ej. < 0.6), el sistema recurre a un diccionario de palabras clave predefinidas para asignar la categoría.
4. **Reentrenamiento:** La aplicación permite reentrenar los modelos con los nuevos datos etiquetados manualmente por el usuario, guardando los archivos `.pkl` en la carpeta `modelos/`. También incluye un sistema de **rollback** para volver a versiones anteriores si el rendimiento decae.

---

## 📂 Estructura del Proyecto

### Estructura Local (Jupyter Notebook)
```text
gestor_variables_notebook/
├── modelos/                     # Modelos ML entrenados (.pkl) y vectorizadores
├── venv/                        # Entorno virtual de Python (ignorado en Git)
├── .deps_installed              # Archivo de control de dependencias instaladas
├── .env                         # Variables de entorno (Supabase, Ngrok) - ¡NO SUBIR!
├── .gitignore                   # Archivos ignorados por Git
├── carga_de_estados.ipynb       # Notebook auxiliar para carga de estados
├── gestor_de_variables.ipynb    # Notebook principal (Backend + Frontend)
├── README.md                    # Documentación del proyecto
└── requirements.txt             # Dependencias de Python