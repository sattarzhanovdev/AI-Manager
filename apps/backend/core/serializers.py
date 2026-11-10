import re, json
from django.core.serializers.json import DjangoJSONEncoder
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.db import models
from rest_framework import serializers
from . import models as m


def camel(key):
    return re.sub(r"_([a-z])", lambda x: x[1].upper(), key)


def snake(key):
    return re.sub(r"[A-Z]", lambda x: "_" + x[0].lower(), key)


def phone(value):
    value = re.sub(r"[\s()\-]", "", value)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", value):
        raise serializers.ValidationError(
            "Телефон должен быть в формате E.164, например +996555123456."
        )
    return value


class DomainSerializer(serializers.ModelSerializer):
    """Camel case contract shared with Next.js; JSON payload keys stay untouched."""

    def to_representation(self, obj):
        data = super().to_representation(obj)
        out = {}
        for k, v in data.items():
            f = self.Meta.model._meta.get_field(k) if k not in ["pk"] else None
            key = k + "_id" if isinstance(f, models.ForeignKey) else k
            if k != "company":
                out[camel(key)] = (
                    str(v) if isinstance(f, models.ForeignKey) and v is not None else v
                )
        if hasattr(obj, "contact_id"):
            out["contactName"] = obj.contact.name or None if obj.contact else None
            out["contactPhone"] = obj.contact.phone if obj.contact else None
        if isinstance(obj, m.Appointment):
            out["serviceName"] = obj.service.name if obj.service else None
        if isinstance(obj, m.Membership):
            out.update(
                name=obj.user.get_full_name() or obj.user.email,
                email=obj.user.email,
                telegramLinked=False,
            )
        if isinstance(obj, m.Call):
            out.update(
                isNewCaller=False,
                numberId=str(obj.number_id or ""),
                leadIds=[
                    str(x)
                    for x in m.Lead.objects.filter(
                        company=obj.company, source="call", source_id=obj.pk
                    ).values_list("id", flat=True)
                ],
            )
        return out

    def to_internal_value(self, data):
        mapped = {}
        fields = {f.name: f for f in self.Meta.model._meta.fields}
        for key, value in data.items():
            k = snake(key)
            if (
                k.endswith("_id")
                and k[:-3] in fields
                and isinstance(fields[k[:-3]], models.ForeignKey)
            ):
                k = k[:-3]
            mapped[k] = value
        # Reject cross-tenant FKs, including IDs nested in JSON arrays.
        for k, v in mapped.items():
            f = fields.get(k)
            if isinstance(f, models.ForeignKey) and v is not None:
                if f.related_model is m.Company:
                    raise serializers.ValidationError(
                        {"company": "Компания задаётся сессией."}
                    )
                if issubclass(f.related_model, m.TenantModel):
                    if not f.related_model.objects.filter(
                        pk=v, company=self.context["company"]
                    ).exists():
                        raise serializers.ValidationError({k: "Объект не найден."})
                elif (
                    k in ["user", "assignee"]
                    and not m.Membership.objects.filter(
                        company=self.context["company"], user_id=v, disabled_at=None
                    ).exists()
                ):
                    raise serializers.ValidationError({k: "Сотрудник не найден."})
        for k, model in [
            ("branch_ids", m.Branch),
            ("service_ids", m.Service),
            ("staff_ids", m.Staff),
        ]:
            if k in mapped and (
                not isinstance(mapped[k], list)
                or any(
                    not model.objects.filter(
                        company=self.context["company"], pk=x
                    ).exists()
                    for x in mapped[k]
                )
            ):
                raise serializers.ValidationError({k: "Объект не найден."})
        return super().to_internal_value(mapped)

    def validate(self, data):
        for k in ["phone", "contact_phone", "transfer_phone", "e164"]:
            if data.get(k):
                data[k] = phone(data[k])
        if "timezone" in data:
            try:
                ZoneInfo(data["timezone"])
            except ZoneInfoNotFoundError:
                raise serializers.ValidationError(
                    {"timezone": "Неизвестный часовой пояс."}
                )
        if (
            self.Meta.model is m.Lead
            and data.get("status") == "lost"
            and not data.get("lost_reason", getattr(self.instance, "lost_reason", ""))
        ):
            raise serializers.ValidationError({"lostReason": "Укажите причину отказа."})
        if self.Meta.model is m.Service:
            get = lambda k: data.get(k, getattr(self.instance, k, None))
            t, lo, hi = get("price_type"), get("price_min"), get("price_max")
            if t == "after_inspection" and (lo is not None or hi is not None):
                raise serializers.ValidationError(
                    "Цена после осмотра не содержит чисел."
                )
            if t == "exact" and (lo is None or hi is not None):
                raise serializers.ValidationError("Укажите точную цену.")
            if t == "range" and (lo is None or hi is None or hi < lo):
                raise serializers.ValidationError("Укажите корректный диапазон цен.")
        return data


def serializer_for(model, readonly=()):
    meta = type(
        "Meta",
        (),
        {
            "model": model,
            "exclude": ["company"] if issubclass(model, m.TenantModel) else [],
            "read_only_fields": ["id", "created_at", *readonly],
        },
    )
    return type(model.__name__ + "Serializer", (DomainSerializer,), {"Meta": meta})


def serialize(obj, many=False):
    if many:
        return [serialize(x) for x in obj]
    return json.loads(
        json.dumps(serializer_for(type(obj))(obj).data, cls=DjangoJSONEncoder)
    )
