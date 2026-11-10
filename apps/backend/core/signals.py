from django.db.models.signals import post_save
from django.dispatch import receiver
from . import models as m
from .serializers import serialize


@receiver(post_save)
def publish_event(sender, instance, created, raw=False, **kwargs):
    if raw or sender not in [
        m.Lead,
        m.Call,
        m.Notification,
        m.Conversation,
        m.Message,
        m.Appointment,
        m.Waitlist,
        m.Company,
    ]:
        return
    company_id = instance.pk if sender is m.Company else instance.company_id
    if sender is m.Company:
        payload = {"type": "company.ai_mode", "mode": instance.ai_mode}
    elif sender is m.Waitlist:
        payload = {"type": "waitlist.changed"}
    elif sender is m.Lead:
        payload = {
            "type": "lead.created" if created else "lead.updated",
            "lead": serialize(instance),
        }
    elif sender is m.Call:
        if not created:
            return
        payload = {"type": "call.created", "call": serialize(instance)}
    elif sender is m.Notification:
        payload = {"type": "notification", "notification": serialize(instance)}
    elif sender is m.Conversation:
        payload = {"type": "conversation.updated", "conversation": serialize(instance)}
    elif sender is m.Message:
        payload = {
            "type": "message.created",
            "message": serialize(instance),
            "conversation": serialize(instance.conversation),
        }
    else:
        payload = {"type": "appointment.changed", "appointment": serialize(instance)}
    m.RealtimeEvent.objects.create(company_id=company_id, payload=payload)
