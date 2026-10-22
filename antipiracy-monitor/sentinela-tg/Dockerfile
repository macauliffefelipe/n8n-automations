# La versión de la imagen tiene que coincidir con playwright== en requirements.txt
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py login.py ./
EXPOSE 8088
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8088"]
