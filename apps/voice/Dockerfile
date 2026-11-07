FROM python:3.12-slim
WORKDIR /srv
COPY packages/dialog/prompts packages/dialog/prompts
COPY packages/dialog/generated packages/dialog/generated
COPY apps/voice apps/voice
RUN pip install --no-cache-dir ./apps/voice && python -m allvoice.agent download-files
CMD ["python", "-m", "allvoice.agent", "start"]
